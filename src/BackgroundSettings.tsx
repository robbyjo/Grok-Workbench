import { useEffect, useState } from 'react';
import type { State, Thread, Wire } from '../shared/types';
import type { Automation } from '../shared/automation';
import { t } from '../shared/i18n';

export default function BackgroundSettings({
  state,
  thread,
  select,
}: {
  state: State;
  thread?: Thread;
  select: (id: string) => void;
}) {
  const [data, setData] = useState<Wire>({ schedules: [], watches: [], runs: [] }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Automation>(),
    [name, setName] = useState(''),
    [prompt, setPrompt] = useState(''),
    [projectId, setProject] = useState(
      thread?.projectId ?? state.projects.find((p) => !p.hidden)?.id ?? '',
    ),
    [threadId, setThread] = useState('');
  const [kind, setKind] = useState('interval'),
    [minutes, setMinutes] = useState(60),
    [at, setAt] = useState(''),
    [time, setTime] = useState('09:00'),
    [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [enabled, setEnabled] = useState(false),
    [providerId, setProvider] = useState(''),
    [model, setModel] = useState('');
  const [providers, setProviders] = useState<Wire[]>([]),
    [repository, setRepository] = useState(''),
    [number, setNumber] = useState(1),
    [watchPrompt, setWatchPrompt] = useState(
      'Inspect this pull request update and address actionable feedback. Run relevant tests. Leave commits, pushes, review submissions and merges for explicit review.',
    ),
    [autoContinue, setAuto] = useState(false);
  const refresh = () => window.desktop.call<Wire>('background:list').then(setData);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    void window.desktop
      .call<Wire[]>('providers:list')
      .then(setProviders)
      .catch((e) => setError(String(e)));
    return window.desktop.onEvent((e) => {
      if (e.type === 'background-changed') void refresh().catch(() => {});
    });
  }, []);
  async function operation(method: string, input: Wire) {
    setBusy(true);
    setError('');
    try {
      const value = await window.desktop.call(method, input);
      await refresh();
      return value;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function load(s: Automation) {
    setEdit(s);
    setName(s.name);
    setPrompt(s.prompt);
    setProject(s.projectId);
    setThread(s.threadId ?? '');
    setEnabled(s.enabled);
    setProvider(s.providerId ?? '');
    setModel(s.model ?? '');
    setKind(s.schedule.kind);
    if (s.schedule.kind === 'interval') setMinutes(s.schedule.minutes);
    if (s.schedule.kind === 'once') {
      const date = new Date(s.schedule.at);
      setAt(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    }
    if (s.schedule.kind === 'daily') {
      setTime(s.schedule.time);
      setTimezone(s.schedule.timezone);
    }
  }
  const editAction = (kind: string, row: Wire, operationName: string) =>
    operation('background:edit', {
      kind,
      itemId: row.id,
      revision: row.revision,
      operation: operationName,
    });
  return (
    <section className="feature-settings">
      <h3>{t('Scheduled automations')}</h3>
      <p>
        {t(
          'Runs while Workbench is open. Sleeping or closed periods are coalesced into one due run. Permissions and project trust still apply; interrupted runs are never replayed.',
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          let schedule: Wire;
          try {
            schedule =
              kind === 'once'
                ? { kind, at: new Date(at).toISOString() }
                : kind === 'daily'
                  ? { kind, time, timezone }
                  : { kind, minutes };
          } catch {
            setError(t('Choose a valid date and time.'));
            return;
          }
          void operation('background:save', {
            id: edit?.id,
            revision: edit?.revision,
            name,
            prompt,
            projectId,
            threadId: threadId || undefined,
            providerId: threadId ? undefined : providerId || undefined,
            model: model || undefined,
            enabled,
            schedule,
          }).then((v) => {
            if (v) {
              setEdit(undefined);
              setName('');
              setPrompt('');
              setEnabled(false);
            }
          });
        }}
      >
        <label>
          {t('Name')}
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('Project')}
          <select
            aria-label={t('Project')}
            value={projectId}
            onChange={(e) => {
              setProject(e.target.value);
              setThread('');
            }}
          >
            {state.projects
              .filter((p) => !p.hidden)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t('Run in')}
          <select
            aria-label={t('Run in')}
            value={threadId}
            onChange={(e) => setThread(e.target.value)}
          >
            <option value="">{t('New chat for each run')}</option>
            {state.threads
              .filter((s) => s.projectId === projectId && !s.archived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
          </select>
        </label>
        {!threadId && (
          <label>
            {t('Provider profile')}
            <select
              aria-label={t('Provider profile')}
              value={providerId}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">{t('Grok account / default')}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('Model ID (optional)')}
          <input
            maxLength={200}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('Use the chat or provider default')}
          />
        </label>
        <label>
          {t('Schedule')}
          <select aria-label={t('Schedule')} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="interval">{t('Interval')}</option>
            <option value="daily">{t('Daily')}</option>
            <option value="once">{t('One time')}</option>
          </select>
        </label>
        {kind === 'interval' && (
          <label>
            {t('Every (minutes)')}
            <input
              type="number"
              min={5}
              max={525600}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
        )}
        {kind === 'once' && (
          <label>
            {t('Date and time (this computer)')}
            <input
              type="datetime-local"
              required
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
        )}
        {kind === 'daily' && (
          <>
            <label>
              {t('Time')}
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label>
              {t('Timezone')}
              <input required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </label>
          </>
        )}
        <label>
          {t('Prompt')}
          <textarea
            required
            rows={5}
            maxLength={20000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('Enable scheduled execution')}
        </label>
        <p className="muted">
          {t(
            'Saving an enabled schedule authorizes future model requests and their normal tool approvals. Account billing applies.',
          )}
        </p>
        <div className="input-row">
          <button disabled={busy || !projectId}>
            {edit ? t('Save changes') : t('Save automation')}
          </button>
          {edit && (
            <button
              type="button"
              onClick={() => {
                setEdit(undefined);
                setName('');
                setPrompt('');
                setEnabled(false);
              }}
            >
              {t('Cancel editing')}
            </button>
          )}
        </div>
      </form>
      <div className="feature-list">
        {data.schedules.map((s: Automation) => (
          <article key={s.id}>
            <strong>{s.name}</strong>
            <p>
              {s.enabled ? t('Enabled') : t('Paused')} ·{' '}
              {s.nextAt ? new Date(s.nextAt).toLocaleString() : t('Finished')}
            </p>
            {s.error && <p role="status">{s.error}</p>}
            <div className="input-row">
              <button disabled={busy} onClick={() => load(s)}>
                {t('Edit')}
              </button>
              <button
                disabled={busy}
                onClick={() => void editAction('schedule', s, s.enabled ? 'pause' : 'resume')}
              >
                {s.enabled ? t('Pause') : t('Resume')}
              </button>
              <button disabled={busy} onClick={() => void editAction('schedule', s, 'remove')}>
                {t('Remove')}
              </button>
            </div>
          </article>
        ))}
      </div>
      <h3>{t('PR monitoring and continuation')}</h3>
      <p>
        {t(
          'Checks GitHub every two minutes using your GitHub CLI sign-in. New commits, reviews, comments and check results are coalesced. Automatic continuation is limited to six turns per watch per hour.',
        )}
      </p>
      {thread ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void operation('background:watch', {
              threadId: thread.id,
              repository,
              number,
              prompt: watchPrompt,
              autoContinue,
            });
          }}
        >
          <p>
            {t('Continue in chat')}: {thread.title}
          </p>
          <label>
            {t('Repository (owner/name)')}
            <input required value={repository} onChange={(e) => setRepository(e.target.value)} />
          </label>
          <label>
            {t('Pull request number')}
            <input
              type="number"
              min={1}
              value={number}
              onChange={(e) => setNumber(Number(e.target.value))}
            />
          </label>
          <label>
            {t('Continuation prompt')}
            <textarea
              required
              rows={4}
              value={watchPrompt}
              maxLength={10000}
              onChange={(e) => setWatchPrompt(e.target.value)}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={autoContinue}
              onChange={(e) => setAuto(e.target.checked)}
            />
            {t('Automatically continue this chat when the PR changes')}
          </label>
          <button disabled={busy}>{t('Watch pull request')}</button>
        </form>
      ) : (
        <p>{t('Open a project chat to add a pull request watch.')}</p>
      )}
      <button disabled={busy} onClick={() => void operation('background:check', {})}>
        {t('Check now')}
      </button>
      <div className="feature-list">
        {data.watches.map((w: Wire) => (
          <article key={w.id}>
            <strong>
              {w.repository}#{w.number}
            </strong>
            <p>
              {w.enabled ? t('Enabled') : t('Paused')} ·{' '}
              {w.autoContinue ? t('Automatic continuation') : t('Monitor only')}
            </p>
            <p>{w.checkedAt && new Date(w.checkedAt).toLocaleString()}</p>
            {w.pending && <p role="status">{t('Pull request changed.')}</p>}
            {w.lastError && <p role="alert">{w.lastError}</p>}
            <div className="input-row">
              <button onClick={() => select(w.threadId)}>{t('Open chat')}</button>
              <button
                disabled={busy}
                onClick={() => void editAction('watch', w, w.enabled ? 'pause' : 'resume')}
              >
                {w.enabled ? t('Pause') : t('Resume')}
              </button>
              <button disabled={busy} onClick={() => void editAction('watch', w, 'remove')}>
                {t('Remove')}
              </button>
            </div>
          </article>
        ))}
      </div>
      <h3>{t('Recent runs')}</h3>
      <div className="feature-list">
        {[...data.runs]
          .reverse()
          .slice(0, 30)
          .map((r: Wire) => (
            <article key={r.id}>
              <strong>{r.name}</strong>
              <p>
                {t(r.status)} · {new Date(r.startedAt).toLocaleString()}
              </p>
              {r.error && <p>{r.error}</p>}
              <button onClick={() => select(r.threadId)}>{t('Open chat')}</button>
              {r.status === 'running' && (
                <button
                  disabled={busy}
                  onClick={() => void operation('background:cancel', { runId: r.id })}
                >
                  {t('Stop run')}
                </button>
              )}
            </article>
          ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
