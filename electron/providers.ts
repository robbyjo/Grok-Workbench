import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import type { History } from './history';
import { openDocument, saveDocument, createDocument } from './editor';
import type { Wire } from '../shared/types';
import { encryptedStorageAvailable } from './credential-storage';

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  contextWindow: number;
  backend: 'chat_completions' | 'responses' | 'messages';
  revision: string;
}
export const providerModel = (id: string) => 'workbench-' + id;
const begin = '# BEGIN GROK WORKBENCH PROVIDERS';
const end = '# END GROK WORKBENCH PROVIDERS';
export class Providers {
  private profiles: ProviderProfile[];
  private sessions = new Map<string, string>();
  private recovery?: { profile: ProviderProfile };
  constructor(
    private root: string,
    private history: History,
    private home: () => string,
    private crypto: {
      isEncryptionAvailable(): boolean;
      getSelectedStorageBackend?(): string;
      encryptString(value: string): Buffer;
      decryptString(value: Buffer): string;
    },
  ) {
    this.profiles = history.value('provider-profiles') ?? [];
    this.recovery = history.value('provider-update-pending') ?? undefined;
    if (this.recovery)
      this.profiles = [
        ...this.profiles.filter((p) => p.id !== this.recovery!.profile.id),
        this.recovery.profile,
      ];
    mkdirSync(root, { recursive: true });
  }
  private keyPath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid provider ID.');
    return join(this.root, id + '.bin');
  }
  list() {
    return this.profiles.map((p) => ({
      ...p,
      needsRecovery: this.recovery?.profile.id === p.id,
      modelId: providerModel(p.id),
      hasKey: this.sessions.has(p.id) || existsSync(this.keyPath(p.id)),
      remembered: existsSync(this.keyPath(p.id)),
    }));
  }
  get(id: string) {
    const row = this.profiles.find((p) => p.id === id);
    if (!row) throw new Error('Provider profile is unavailable.');
    return row;
  }
  private key(id: string) {
    if (
      !this.sessions.has(id) &&
      existsSync(this.keyPath(id)) &&
      !encryptedStorageAvailable(this.crypto)
    )
      throw new Error('Secure system keyring unavailable. Re-enter a session-only provider key.');
    const key =
      this.sessions.get(id) ??
      (existsSync(this.keyPath(id))
        ? this.crypto.decryptString(readFileSync(this.keyPath(id)))
        : undefined);
    if (!key) throw new Error('Re-enter the provider key before using this profile.');
    return key;
  }
  assert(id: string) {
    this.get(id);
    this.key(id);
  }
  environment(base: NodeJS.ProcessEnv, selected?: string): NodeJS.ProcessEnv {
    if (this.recovery)
      throw new Error(
        'A provider update did not finish. Edit the marked profile in Settings → Providers and save its reviewed configuration before starting an engine.',
      );
    const env = { ...base };
    for (const p of this.profiles) {
      // A nonempty sentinel prevents native fallback to an unrelated xAI credential.
      try {
        env[this.variable(p.id)] =
          p.id === selected ? this.key(p.id) : 'workbench-provider-key-unavailable';
      } catch {
        env[this.variable(p.id)] = 'workbench-provider-key-unavailable';
      }
    }
    if (selected) {
      this.assert(selected);
      // The native overlay allows model defaults and still applies managed requirements.
      // Preserve an existing inline overlay; path-based overlays need explicit reconciliation.
      if (env.GROK_CONFIG_PATH && !env.GROK_CONFIG)
        throw new Error(
          'A GROK_CONFIG_PATH overlay is active. Use native model selection or reconcile that overlay before choosing a provider profile.',
        );
      let overlay: Wire = {};
      if (env.GROK_CONFIG) {
        try {
          overlay = JSON.parse(env.GROK_CONFIG);
          if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) throw new Error();
        } catch {
          throw new Error('GROK_CONFIG must be a JSON object before selecting a provider profile.');
        }
      }
      env.GROK_CONFIG = JSON.stringify({
        ...overlay,
        models: { ...overlay.models, default: providerModel(selected) },
      });
    }
    return env;
  }
  private variable(id: string) {
    return 'GROK_WORKBENCH_PROVIDER_KEY_' + id.replaceAll('-', '').toUpperCase();
  }
  private validate(input: Wire, id: string): ProviderProfile {
    const clean = (value: unknown, max: number) => {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > max ||
        /[\r\n\0]/.test(value)
      )
        throw new Error('Invalid provider name, model or endpoint.');
      return value.trim();
    };
    const url = new URL(clean(input.baseUrl, 2048));
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    )
      throw new Error('Use HTTPS, or HTTP on loopback for a local model server.');
    if (
      !['chat_completions', 'responses', 'messages'].includes(input.backend) ||
      !Number.isSafeInteger(input.contextWindow) ||
      input.contextWindow < 1024 ||
      input.contextWindow > 10000000
    )
      throw new Error('Choose an API backend and context window of 1,024–10,000,000 tokens.');
    return {
      id,
      name: clean(input.name, 120),
      baseUrl: url.href.replace(/\/$/, ''),
      model: clean(input.model, 200),
      contextWindow: input.contextWindow,
      backend: input.backend,
      revision: randomUUID(),
    };
  }
  private async config() {
    mkdirSync(this.home(), { recursive: true });
    try {
      return await openDocument(this.home(), 'config.toml');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return { text: '', revision: undefined };
    }
  }
  private render(original: string, profiles: ProviderProfile[]) {
    const start = original.indexOf(begin),
      finish = original.indexOf(end);
    if (
      start < 0 !== finish < 0 ||
      (start >= 0 &&
        (finish < start ||
          original.indexOf(begin, start + begin.length) >= 0 ||
          original.indexOf(end, finish + end.length) >= 0))
    )
      throw new Error('Provider block is malformed. Review config.toml in Configuration.');
    const base =
      start < 0 ? original : original.slice(0, start) + original.slice(finish + end.length);
    const lines = profiles.map((p) => {
      const versionHeader =
        p.backend === 'messages' && new URL(p.baseUrl).hostname === 'api.anthropic.com'
          ? 'extra_headers = { "anthropic-version" = "2023-06-01" }\n'
          : '';
      return `\n[model.${providerModel(p.id)}]\nmodel = ${JSON.stringify(p.model)}\nname = ${JSON.stringify(p.name)}\nbase_url = ${JSON.stringify(p.baseUrl)}\nenv_key = ${JSON.stringify(this.variable(p.id))}\nauth_provider = "workbench-desktop-key-required"\napi_backend = ${JSON.stringify(p.backend)}\ncontext_window = ${p.contextWindow}\n${versionHeader}`;
    });
    // A named, failing credential helper blocks the native fallback to an unrelated
    // xAI key when these model entries are used outside the desktop's environment.
    const command = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args =
      process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', 'exit 1']
        : ['-c', 'exit 1'];
    const guard = profiles.length
      ? `\n[auth_provider.workbench-desktop-key-required]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\ntimeout_secs = 5\n`
      : '';
    return `${base.trimEnd()}\n\n${begin}\n${lines.join('')}${guard}\n${end}\n`;
  }
  async preview(input: Wire) {
    if (this.recovery && input.id !== this.recovery.profile.id)
      throw new Error('Repair or remove the marked incomplete provider first.');
    const old = input.id ? this.get(input.id) : undefined;
    if (old && old.revision !== input.revision) throw new Error('Provider changed. Refresh first.');
    if (!old && this.profiles.length >= 30) throw new Error('Provider limit reached (30).');
    const profile = this.validate(input, old?.id ?? randomUUID());
    const current = await this.config();
    const profiles = [...this.profiles.filter((p) => p.id !== profile.id), profile];
    const source = this.render(current.text, profiles);
    (await import('smol-toml')).parse(source);
    const review = {
      profile,
      source,
      revision: current.revision,
      token: randomUUID(),
      profilesRevision: this.profiles.map((p) => p.revision).join(':'),
    };
    this.pending = review;
    return review;
  }
  private pending?: {
    profile: ProviderProfile;
    source: string;
    revision?: string;
    token: string;
    profilesRevision: string;
  };
  async save(input: Wire) {
    const review = this.pending;
    if (
      !review ||
      review.token !== input.token ||
      input.confirmed !== true ||
      review.profilesRevision !== this.profiles.map((p) => p.revision).join(':')
    )
      throw new Error('Preview and confirm the current provider configuration.');
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (key && (key.length > 4096 || /[\r\n\0]/.test(key)))
      throw new Error('Enter a valid provider API key.');
    const p = review.profile;
    const retainedKey = key || this.key(p.id);
    if (input.remember === true && !encryptedStorageAvailable(this.crypto))
      throw new Error('Encrypted storage unavailable. Use a session-only key.');
    const current = await this.config();
    if (current.revision !== review.revision)
      throw new Error('Configuration changed. Preview again.');
    // Cross-file changes are not atomic. A durable admission barrier prevents either an
    // old endpoint/new key or a new endpoint/old key from running after any partial failure.
    this.recovery = { profile: p };
    this.history.setValue('provider-update-pending', this.recovery);
    this.profiles = [...this.profiles.filter((row) => row.id !== p.id), p];
    // Write the encrypted key before making its model definition available.
    if (input.remember === true) {
      const file = this.keyPath(p.id),
        temporary = file + '.' + randomUUID();
      try {
        writeFileSync(temporary, this.crypto.encryptString(retainedKey), {
          flag: 'wx',
          mode: 0o600,
        });
        renameSync(temporary, file);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    }
    this.sessions.set(p.id, retainedKey);
    if (input.remember !== true && existsSync(this.keyPath(p.id))) unlinkSync(this.keyPath(p.id));
    if (!current.revision) await createDocument(this.home(), 'config.toml');
    const revision = current.revision ?? (await openDocument(this.home(), 'config.toml')).revision;
    await saveDocument(this.home(), 'config.toml', review.source, revision);
    this.history.transaction(() => {
      this.history.setValue('provider-profiles', this.profiles);
      this.history.setValue('provider-update-pending', null);
    });
    this.recovery = undefined;
    this.pending = undefined;
    return this.list();
  }
  async remove(id: string, revision: string) {
    if (this.recovery && id !== this.recovery.profile.id)
      throw new Error('Repair or remove the marked incomplete provider first.');
    const row = this.get(id);
    if (row.revision !== revision) throw new Error('Provider changed. Refresh first.');
    const current = await this.config();
    if (!current.revision) throw new Error('Provider config is missing. Review it first.');
    const profiles = this.profiles.filter((p) => p.id !== id);
    const source = this.render(current.text, profiles);
    (await import('smol-toml')).parse(source);
    await saveDocument(this.home(), 'config.toml', source, current.revision);
    this.history.transaction(() => {
      this.history.setValue('provider-profiles', profiles);
      this.history.setValue('provider-update-pending', null);
    });
    this.profiles = profiles;
    this.recovery = undefined;
    this.sessions.delete(id);
    if (existsSync(this.keyPath(id))) unlinkSync(this.keyPath(id));
  }
  modelSelection(value: string) {
    const p = this.profiles.find((p) => providerModel(p.id) === value);
    if (p) this.assert(p.id);
    else if (value.startsWith('workbench-'))
      throw new Error('Provider is missing. Choose an available profile.');
    return p?.id;
  }
}
