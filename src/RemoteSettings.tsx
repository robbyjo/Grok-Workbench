import { useEffect, useState } from 'react';
import type { State, Wire } from '../shared/types';
import { t } from '../shared/i18n';
export default function RemoteSettings({ state }: { state: State }) {
  const [status, setStatus] = useState<Wire>({}),
    [projects, setProjects] = useState<string[]>([]),
    [port, setPort] = useState(0),
    [publicUrl, setUrl] = useState(''),
    [control, setControl] = useState(false),
    [token, setToken] = useState(''),
    [show, setShow] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () =>
      window.desktop
        .call('remote:status')
        .then(setStatus)
        .catch((e) => setError(String(e)));
    void refresh();
    return window.desktop.onEvent((e) => {
      if (e.type === 'background-changed') void refresh();
    });
  }, []);
  async function start() {
    setBusy(true);
    setError('');
    try {
      const value = await window.desktop.call('remote:start', {
        projectIds: projects,
        port,
        publicUrl: publicUrl.trim() || undefined,
        control,
      });
      setStatus(value);
      setToken(value.token);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="feature-settings">
      <h3>{t('Remote access')}</h3>
      <p>
        {t(
          'Share selected project chats through a paired mobile page and REST API. The server binds only to this computer. Use an HTTPS reverse tunnel or SSH forwarding for access from another device.',
        )}
      </p>
      {!status.running ? (
        <>
          <fieldset>
            <legend>{t('Projects to share')}</legend>
            {state.projects
              .filter((p) => !p.hidden)
              .map((p) => (
                <label className="check-row" key={p.id}>
                  <input
                    type="checkbox"
                    checked={projects.includes(p.id)}
                    onChange={(e) =>
                      setProjects(
                        e.target.checked
                          ? [...projects, p.id]
                          : projects.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
          </fieldset>
          <label>
            {t('Local port (0 = automatic)')}
            <input
              type="number"
              min={0}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </label>
          <label>
            {t('HTTPS tunnel origin (optional)')}
            <input
              type="url"
              placeholder="https://your-tunnel.example"
              value={publicUrl}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={control}
              onChange={(e) => setControl(e.target.checked)}
            />
            {t('Allow remote prompts and stop requests')}
          </label>
          <p className="muted">
            {t(
              'Read access includes chat contents in the selected projects. Approval answers, credentials, files and settings are not exposed. Remote control inherits each chat’s tool permissions.',
            )}
          </p>
          <button disabled={busy || !projects.length} onClick={() => void start()}>
            {t('Start remote access')}
          </button>
        </>
      ) : (
        <>
          <p role="status">
            {t('Remote access is running')} ·{' '}
            {status.control ? t('Control enabled') : t('Read only')}
          </p>
          <p>
            {t('Local address')}: <code>{status.localUrl}</code>
          </p>
          {status.publicUrl && (
            <p>
              {t('Remote address')}: <code>{status.publicUrl}</code>
            </p>
          )}
          {token ? (
            <>
              <label>
                {t('Pairing token')}
                <input
                  readOnly
                  type={show ? 'text' : 'password'}
                  value={token}
                  autoComplete="off"
                />
              </label>
              <button onClick={() => setShow((v) => !v)}>
                {show ? t('Hide token') : t('Show token')}
              </button>
            </>
          ) : (
            <p>
              {t(
                'The token was shown when access started. Stop and restart access to pair another device.',
              )}
            </p>
          )}
          <p>
            {t(
              'Open the address on your device and enter the token. Stop revokes all access. Pairing does not survive an application restart.',
            )}
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(await window.desktop.call('remote:stop'));
                setToken('');
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Stop and revoke access')}
          </button>
        </>
      )}
      <details>
        <summary>{t('API and connection details')}</summary>
        <p>
          <code>Authorization: Bearer &lt;token&gt;</code>
        </p>
        <pre>
          {
            'GET /v1/sessions\nGET /v1/sessions/{id}\nPOST /v1/sessions/{id}/turns\nPOST /v1/sessions/{id}/cancel'
          }
        </pre>
        <p>
          {t(
            'Sending a turn requires a unique Idempotency-Key header and a JSON object with a text field. Use the same key only to retry the same request during this pairing.',
          )}
        </p>
        <p>
          {t(
            'For SSH forwarding, choose a fixed port and forward it to 127.0.0.1 on the Workbench computer. For an HTTPS tunnel, enter its exact public origin before starting access.',
          )}
        </p>
      </details>
      <h4>{t('Access activity')}</h4>
      {status.audit
        ?.slice()
        .reverse()
        .map((r: Wire, i: number) => (
          <p key={i}>
            {new Date(r.at).toLocaleString()} · {r.action}
          </p>
        ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
