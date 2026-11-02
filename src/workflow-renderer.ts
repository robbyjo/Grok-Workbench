import type { DesktopAPI, Wire } from '../shared/types';
const from64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function to64(bytes: Uint8Array) {
  let out = '';
  for (let n = 0; n < bytes.length; n += 16384)
    out += String.fromCharCode(...bytes.subarray(n, n + 16384));
  return btoa(out);
}
export async function renderWorkflow(kind: string, data: string, options: Wire): Promise<Wire> {
  if (kind === 'audio') {
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(from64(data).buffer);
      if (
        ![1, 2].includes(audio.numberOfChannels) ||
        audio.length * audio.numberOfChannels * 2 > 16 * 1024 * 1024
      )
        throw new Error('Decoded audio supports mono/stereo up to 16 MiB.');
      const bytes = new Uint8Array(audio.length * audio.numberOfChannels * 2),
        view = new DataView(bytes.buffer),
        channels = Array.from({ length: audio.numberOfChannels }, (_, n) =>
          audio.getChannelData(n),
        );
      for (let f = 0; f < audio.length; f++)
        for (let c = 0; c < channels.length; c++)
          view.setInt16(
            (f * channels.length + c) * 2,
            Math.round(Math.max(-1, Math.min(1, channels[c][f])) * 32767),
            true,
          );
      return { samples: to64(bytes), rate: audio.sampleRate, channels: audio.numberOfChannels };
    } finally {
      await context.close();
    }
  }
  if (kind === 'svg') {
    if (
      !Number.isInteger(options.width) ||
      !Number.isInteger(options.height) ||
      options.width < 16 ||
      options.height < 16 ||
      options.width > 4096 ||
      options.height > 4096
    )
      throw new Error('Invalid vector export dimensions.');
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const image = new Image();
    image.src = 'data:image/svg+xml;base64,' + data;
    await image.decode();
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { png: canvas.toDataURL('image/png').split(',')[1] };
  }
  if (kind !== 'pdf') throw new Error('Unknown renderer operation.');
  const pdfjs = await import('pdfjs-dist'),
    worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: from64(data), useWorkerFetch: false, enableXfa: false });
  const timer = setTimeout(() => void task.destroy(), 30000);
  task.onPassword = () => void task.destroy();
  try {
    const pdf = await task.promise;
    const pages: Wire[] = [];
    const selected =
      options.pages ?? Array.from({ length: Math.min(pdf.numPages, 100) }, (_, i) => i + 1);
    if (
      !Array.isArray(selected) ||
      !selected.length ||
      selected.length > (options.raster ? 10 : 100) ||
      selected.some((n) => !Number.isInteger(n) || n < 1 || n > pdf.numPages)
    )
      throw new Error('Invalid PDF pages (100 text / 10 raster maximum).');
    let length = 0;
    for (const n of selected) {
      const page = await pdf.getPage(n),
        content = await page.getTextContent();
      const items = content.items.filter(
        (v): v is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in v,
      );
      const text = items
        .map((v) => v.str + (v.hasEOL ? '\n' : ' '))
        .join('')
        .trim();
      length += text.length;
      if (length > 120000) throw new Error('PDF text exceeds 120,000 characters.');
      const lines: Wire[] = [];
      for (const item of items
        .slice()
        .sort((a, b) =>
          Math.abs(b.transform[5] - a.transform[5]) > 3
            ? b.transform[5] - a.transform[5]
            : a.transform[4] - b.transform[4],
        )) {
        let line = lines.find((l) => Math.abs(l.y - item.transform[5]) < 3);
        if (!line) {
          line = { y: item.transform[5], items: [] };
          lines.push(line);
        }
        line.items.push({ text: item.str, x: item.transform[4], width: item.width });
      }
      const cuts = options.columns ?? [];
      if (
        !Array.isArray(cuts) ||
        cuts.length > 30 ||
        cuts.some(
          (v, i) =>
            typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (i > 0 && v <= cuts[i - 1]),
        )
      )
        throw new Error('Table column boundaries must be increasing PDF x coordinates.');
      const rows = lines.map((l) => {
        if (!cuts.length) return l.items.map((i: Wire) => i.text);
        const row = Array.from({ length: cuts.length + 1 }, () => [] as string[]);
        for (const item of l.items) {
          const col = cuts.filter((x: number) => x <= item.x).length;
          row[col].push(item.text);
        }
        return row.map((c) => c.join(' ').trim());
      });
      const result: Wire = { page: n, text, rows };
      if (options.raster) {
        const base = page.getViewport({ scale: 1 }),
          scale = Math.min(2, 2400 / Math.max(base.width, base.height)),
          viewport = page.getViewport({ scale }),
          canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        result.png = canvas.toDataURL('image/png').split(',')[1];
      }
      pages.push(result);
      page.cleanup();
    }
    return {
      numPages: pdf.numPages,
      pages,
      notice: 'Text rows follow layout coordinates; inferred table structure requires review.',
    };
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
export function installWorkflowRenderer(api: DesktopAPI) {
  return api.onEvent((event) => {
    if (event.type !== 'desktop-render') return;
    void renderWorkflow(event.kind, event.data, event.options)
      .then(
        (value) => api.call('desktop-workflows:render-result', { requestId: event.id, value }),
        (e) =>
          api.call('desktop-workflows:render-result', { requestId: event.id, error: String(e) }),
      )
      .catch(() => {});
  });
}
