import type { Wire } from '../../shared/types';
import { randomUUID } from 'node:crypto';
import { workspaceFile, save, list } from './io';
import { localJSON, localRequest, loopback } from './local-api';
import { setTimeout as delay } from 'node:timers/promises';
export class ComfyWorkflows {
  private approved = new Map<string, { path: string; sha256: string; origin: string }>();
  async approve(id: string, root: string, path: string, origin = 'http://127.0.0.1:8188') {
    loopback(origin);
    const file = await workspaceFile(root, path, 1024 * 1024);
    this.parse(file.bytes);
    this.approved.set(id, { path: file.path, sha256: file.sha256, origin });
    return { path: file.path, sha256: file.sha256, origin };
  }
  status(id: string) {
    return this.approved.get(id);
  }
  revoke(id?: string) {
    id ? this.approved.delete(id) : this.approved.clear();
  }
  private parse(bytes: Buffer) {
    const workflow = JSON.parse(bytes.toString('utf8'));
    if (
      !workflow ||
      Array.isArray(workflow) ||
      Object.keys(workflow).length > 200 ||
      !Object.keys(workflow).length ||
      Object.values(workflow).some(
        (v: any) =>
          !v || typeof v.class_type !== 'string' || !v.inputs || typeof v.inputs !== 'object',
      )
    )
      throw new Error('Choose an API-format ComfyUI workflow, with at most 200 nodes.');
    const localNodes = new Set([
      'EmptyImage',
      'SaveImage',
      'PreviewImage',
      'LoadImage',
      'ImageScale',
      'ImageScaleBy',
      'ImageBatch',
      'ImageInvert',
      'CheckpointLoaderSimple',
      'CLIPTextEncode',
      'KSampler',
      'KSamplerAdvanced',
      'EmptyLatentImage',
      'VAEDecode',
      'VAEEncode',
      'VAELoader',
      'LoraLoader',
      'CLIPSetLastLayer',
      'UNETLoader',
      'DualCLIPLoader',
      'CLIPLoader',
      'ModelSamplingFlux',
    ]);
    for (const node of Object.values(workflow) as Wire[]) {
      if (!localNodes.has(node.class_type))
        throw new Error(
          'This integration runs supported built-in local image nodes only: ' + node.class_type,
        );
      for (const field of ['width', 'height'])
        if (
          typeof node.inputs[field] === 'number' &&
          (node.inputs[field] < 16 || node.inputs[field] > 2048)
        )
          throw new Error('Image dimensions must be 16..2048.');
      if (
        typeof node.inputs.batch_size === 'number' &&
        (node.inputs.batch_size < 1 || node.inputs.batch_size > 4)
      )
        throw new Error('Batch size must be 1..4.');
      if (
        node.class_type.startsWith('KSampler') &&
        typeof node.inputs.steps === 'number' &&
        (node.inputs.steps < 1 || node.inputs.steps > 40)
      )
        throw new Error('Sampler steps must be 1..40.');
    }
    return workflow;
  }
  async run(id: string, root: string, out: string, input: Wire, signal: AbortSignal) {
    const approved = this.approved.get(id);
    if (!approved)
      throw new Error(
        'Select and approve an existing ComfyUI API workflow in the workflow panel first.',
      );
    const source = await workspaceFile(root, input.path, 1024 * 1024);
    if (source.path !== approved.path || source.sha256 !== approved.sha256)
      throw new Error('ComfyUI workflow changed; review it again.');
    const variants = input.overrides?.map((v: Wire) => v.changes) ?? input.variants ?? [[]];
    list(variants, 6);
    const files: Wire[] = [],
      runs: Wire[] = [];
    for (let index = 0; index < variants.length; index++) {
      if (signal.aborted)
        throw new Error('Stopped tracking ComfyUI. An already queued job may still finish.');
      const workflow = this.parse(source.bytes);
      if (!Array.isArray(variants[index]) || variants[index].length > 20)
        throw new Error('Supply at most 20 typed overrides per variant.');
      for (const edit of variants[index]) {
        const node = workflow[edit.node];
        if (!node) throw new Error('Unknown workflow node.');
        if (
          node.class_type === 'CLIPTextEncode' &&
          edit.input === 'text' &&
          typeof edit.value === 'string' &&
          edit.value.length <= 10000
        )
          node.inputs.text = edit.value;
        else if (
          node.class_type === 'KSampler' &&
          ['seed', 'steps', 'cfg', 'denoise'].includes(edit.input) &&
          typeof edit.value === 'number' &&
          Number.isFinite(edit.value)
        ) {
          const max: Wire = { seed: Number.MAX_SAFE_INTEGER, steps: 40, cfg: 30, denoise: 1 };
          if (
            edit.value < 0 ||
            edit.value > max[edit.input] ||
            (['seed', 'steps'].includes(edit.input) && !Number.isInteger(edit.value)) ||
            (edit.input === 'steps' && edit.value < 1)
          )
            throw new Error('Sampler override exceeds limits.');
          node.inputs[edit.input] = edit.value;
        } else
          throw new Error(
            'Only CLIPTextEncode text and bounded KSampler values may be overridden.',
          );
      }
      const submitted = await localJSON(approved.origin, '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
        signal,
      });
      const prompt = submitted.value.prompt_id;
      if (typeof prompt !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(prompt))
        throw new Error(
          'ComfyUI rejected the workflow or returned no prompt ID. Inspect the queue before retrying.',
        );
      runs.push({ prompt_id: prompt, state: 'queued' });
      const deadline = Date.now() + 300000;
      let entry: Wire | undefined;
      while (Date.now() < deadline && !signal.aborted) {
        const history = (
          await localJSON(approved.origin, '/history/' + encodeURIComponent(prompt), { signal })
        ).value;
        entry = history[prompt];
        if (entry?.status?.status_str === 'error')
          throw new Error('ComfyUI execution failed; inspect its native history.');
        if (entry?.status?.completed || entry?.outputs) break;
        await delay(500, undefined, { signal });
      }
      if (signal.aborted || !entry?.outputs)
        throw new Error(
          'ComfyUI did not complete within the bounded wait. Its queued job may still finish; do not blindly resubmit.',
        );
      let count = 0;
      for (const output of Object.values(entry.outputs) as Wire[])
        for (const image of output.images ?? []) {
          if (++count > 8) throw new Error('A variant produced more than eight images.');
          if (
            typeof image.filename !== 'string' ||
            (typeof image.subfolder !== 'undefined' && typeof image.subfolder !== 'string') ||
            !['output', 'temp'].includes(image.type ?? 'output')
          )
            throw new Error('Unexpected ComfyUI image descriptor.');
          const query = new URLSearchParams({
            filename: image.filename,
            subfolder: image.subfolder ?? '',
            type: image.type ?? 'output',
          });
          const { bytes } = await localRequest(
            approved.origin,
            '/view?' + query,
            { signal },
            20 * 1024 * 1024,
          );
          const suffix =
            bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
              ? '.png'
              : bytes[0] === 255 && bytes[1] === 216
                ? '.jpg'
                : undefined;
          if (!suffix) throw new Error('ComfyUI returned an unsupported image.');
          files.push(await save(out, `variant-${index + 1}-${count}${suffix}`, bytes));
        }
      if (!count) throw new Error('ComfyUI completed without image artifacts.');
      runs.at(-1)!.state = 'complete';
      files.push(await save(out, `workflow-${index + 1}.json`, JSON.stringify(workflow, null, 2)));
    }
    return {
      files,
      result: {
        runs,
        sourceSha256: source.sha256,
        notice:
          'Executed the explicitly approved local workflow. Custom-node behavior is outside Workbench containment; no global queue clear/interrupt was sent.',
      },
    };
  }
}
