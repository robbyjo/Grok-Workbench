import { useEffect, useState } from 'react';
import type { Thread, Wire } from '../shared/types';
import { t } from '../shared/i18n';
const presets = [
  ['Custom', '', 'chat_completions'],
  ['OpenRouter', 'https://openrouter.ai/api/v1', 'chat_completions'],
  ['DeepSeek', 'https://api.deepseek.com/v1', 'chat_completions'],
  ['OpenAI', 'https://api.openai.com/v1', 'responses'],
  ['Anthropic', 'https://api.anthropic.com/v1', 'messages'],
  ['Local server', 'http://127.0.0.1:1234/v1', 'chat_completions'],
];
export default function ProviderSettings({ thread }: { thread?: Thread }) {
  const [rows, setRows] = useState<Wire[]>([]),
    [edit, setEdit] = useState<Wire>(),
    [name, setName] = useState(''),
    [baseUrl, setUrl] = useState(''),
    [model, setModel] = useState(''),
    [backend, setBackend] = useState('chat_completions'),
    [contextWindow, setContext] = useState(128000),
    [key, setKey] = useState(''),
    [remember, setRemember] = useState(true),
    [review, setReview] = useState<Wire>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<string>();
  const refresh = () => window.desktop.call<Wire[]>('providers:list').then(setRows);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, []);
  async function action(method: string, value: Wire) {
    setBusy(true);
    setError('');
    try {
      const result = await window.desktop.call(method, value);
      await refresh();
      return result;
    } catch (e) {
      setError(String(e));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setEdit(undefined);
    setReview(undefined);
    setName('');
    setUrl('');
    setModel('');
    setKey('');
  }
  return (
    <section className="feature-settings">
      <h3>{t('Provider profiles')}</h3>
      <p>
        {t(
          'Add model endpoints supported by Grok Build. Each profile has its own model, API format, context limit and key. Keys are encrypted locally or retained only for this application session.',
        )}
      </p>
      {thread && <ProviderSelector thread={thread} rows={rows} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action('providers:preview', {
            id: edit?.id,
            revision: edit?.revision,
            name,
            baseUrl,
            model,
            backend,
            contextWindow,
          }).then((v) => {
            if (v) setReview(v);
          });
        }}
        onChange={() => setReview(undefined)}
      >
        <label>
          {t('Endpoint preset')}
          <select
            aria-label={t('Endpoint preset')}
            defaultValue="Custom"
            onChange={(e) => {
              const p = presets.find((p) => p[0] === e.target.value)!;
              setName(p[0] === 'Custom' ? '' : p[0]);
              setUrl(p[1]);
              setBackend(p[2]);
            }}
          >
            {presets.map((p) => (
              <option key={p[0]}>{t(p[0])}</option>
            ))}
          </select>
        </label>
        <label>
          {t('Profile name')}
          <input required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('API base URL')}
          <input type="url" required value={baseUrl} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label>
          {t('Model routing ID')}
          <input
            required
            value={model}
            maxLength={200}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label>
          {t('API format')}
          <select
            aria-label={t('API format')}
            value={backend}
            onChange={(e) => setBackend(e.target.value)}
          >
            <option value="chat_completions">Chat Completions</option>
            <option value="responses">Responses</option>
            <option value="messages">Messages</option>
          </select>
        </label>
        <label>
          {t('Context window (tokens)')}
          <input
            type="number"
            min={1024}
            max={10000000}
            value={contextWindow}
            onChange={(e) => setContext(Number(e.target.value))}
          />
        </label>
        <label>
          {t('Provider API key')}
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            maxLength={4096}
            onChange={(e) => setKey(e.target.value)}
            placeholder={edit ? t('Leave blank to retain the current key') : ''}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('Remember with encrypted storage')}
        </label>
        <p>
          {t(
            'Preview shows the exact non-secret config.toml block. Saving preserves other configuration text and disconnects idle engines. Provider support depends on its API and tool-calling compatibility.',
          )}
        </p>
        <div className="input-row">
          <button disabled={busy}>{t('Preview provider configuration')}</button>
          {edit && (
            <button type="button" onClick={reset}>
              {t('Cancel editing')}
            </button>
          )}
        </div>
      </form>
      {review && (
        <div className="review-panel">
          <pre>{review.source}</pre>
          <button
            disabled={busy}
            onClick={() =>
              void action('providers:save', {
                token: review.token,
                confirmed: true,
                key,
                remember,
              }).then((v) => {
                if (v) reset();
              })
            }
          >
            {t('Save reviewed provider')}
          </button>
        </div>
      )}
      <div className="feature-list">
        {rows.map((p) => (
          <article key={p.id}>
            <strong>{p.name}</strong>
            {p.needsRecovery && (
              <p role="alert">
                {t(
                  'Incomplete update: edit and save this profile again. Engine startup is blocked until repair.',
                )}
              </p>
            )}
            <p>
              {p.model} · {p.backend}
            </p>
            <p>{p.baseUrl}</p>
            <small>
              {p.hasKey
                ? p.remembered
                  ? t('Encrypted key saved')
                  : t('Session-only key')
                : t('Key required')}
            </small>
            <p>
              <code>{p.modelId}</code>
            </p>
            <div className="input-row">
              <button
                disabled={busy}
                onClick={() => {
                  setEdit(p);
                  setName(p.name);
                  setUrl(p.baseUrl);
                  setModel(p.model);
                  setBackend(p.backend);
                  setContext(p.contextWindow);
                  setRemember(p.remembered);
                  setKey('');
                  setReview(undefined);
                }}
              >
                {t('Edit')}
              </button>
              <button disabled={busy} onClick={() => setRemove(p.id)}>
                {t('Remove')}
              </button>
              {remove === p.id && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void action('providers:remove', {
                      providerId: p.id,
                      revision: p.revision,
                    }).then(() => setRemove(undefined))
                  }
                >
                  {t('Confirm removal')}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function ProviderSelector({ thread, rows }: { thread: Thread; rows: Wire[] }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <>
      <label>
        {t('Provider for this chat')}
        <select
          aria-label={t('Provider for this chat')}
          disabled={busy || ['running', 'approval', 'connecting'].includes(thread.status)}
          value={thread.providerId ?? ''}
          onChange={async (e) => {
            setBusy(true);
            setError('');
            try {
              await window.desktop.call('providers:select', {
                id: thread.id,
                providerId: e.target.value,
              });
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="">{t('Grok account / default')}</option>
          {rows.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <small>
        {t('Changing provider starts a fresh native session; the desktop transcript is retained.')}
      </small>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
