import { useEffect, useState } from 'react';
import type { Wire } from '../shared/types';
import DesktopWorkflowsPanel from './DesktopWorkflowsPanel';
const samples = [
  [
    'Office',
    'Create a new Word document titled "Workbench application check" with a short introduction and a two-row task table. Then create an Excel workbook with Item and Cost columns, rows Paper=12 and Ink=28, a SUM formula in B4 and a chart. Use office_create and inspect application_jobs until both are complete. Report actual calculated results and artifact paths.',
  ],
  [
    'Blender',
    'Use blender_create to make an editable scene with a blue cube, an orange sphere beside it and a gray floor plane. Inspect application_jobs until complete and report the saved .blend and preview paths.',
  ],
  [
    'Krita',
    'Use krita_tools to create a NEW 256x256 document, draw a simple colored shape with native Krita tools and preview it. Inspect compatibility first and preserve all existing user documents. Do not overwrite files or change allowed roots. Leave the new editable document open.',
  ],
  [
    'JMP',
    'Use jmp_analyze on points [[1,3.1],[2,4.9],[3,7.2],[4,8.8],[5,11.1],[6,12.9]]. Wait for application_jobs completion, compare the actual native JMP parameter estimates with the independent reference values, and report the scatterplot and data-table paths.',
  ],
  [
    'Shopping',
    'Use the desktop tools in the browser window I selected to inspect products, filters, quantities and prices for my shopping request. Use shopping_plan to check all observed cart prices and my budget. Identify missing shipping/tax. Stop at cart review; do not place an order or submit payment. Ask for product requirements if I have not supplied them.',
  ],
  [
    'Chess',
    'Use chess_position to validate the current board/FEN and every proposed move. For desktop play, use the Lucas Chess or offline browser board I selected. Keep the visible board and returned FEN synchronized and verify each move with a fresh screenshot. Use untimed offline practice. Ask for the starting position if it cannot be read confidently.',
  ],
];
export default function WorkstationPanel({ id }: { id: string }) {
  const [state, setState] = useState<Wire>(),
    [error, setError] = useState(''),
    [prompt, setPrompt] = useState(''),
    [running, setRunning] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);
  const selectGrant = async (app: string, checked: boolean) => {
    if (!state) return;
    const applications = checked
      ? [...state.granted, app]
      : state.granted.filter((v: string) => v !== app);
    setState({ ...state, granted: applications });
    setGrantSaving(true);
    setError('');
    try {
      setState(await window.desktop.call('application:grant', { id, applications }));
    } catch (e) {
      setError(String(e));
      await refresh();
    } finally {
      setGrantSaving(false);
    }
  };
  const refresh = () =>
    window.desktop
      .call<Wire>('application:status', { id })
      .then(setState)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    let live = true;
    const load = () =>
      void window.desktop
        .call<Wire>('application:status', { id })
        .then((v) => {
          if (live) setState(v);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    load();
    const off = window.desktop.onEvent((e) => {
      if (e.type === 'assist-changed') load();
    });
    return () => {
      live = false;
      off();
    };
  }, [id]);
  const run = async (method: string, args: Wire = {}) => {
    setError('');
    try {
      await window.desktop.call(method, { id, ...args });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <details className="application-tools">
      <summary>Office, shopping, art, science &amp; chess</summary>
      <p>
        Application tools are off until enabled for this chat and reset on restart. Office/JMP use
        installed application APIs; Blender creates a separate scene; Krita uses its existing MCP
        bridge. New files go into workbench-output. Existing user documents are preserved.
        Screenshots and tool results are sent to the selected model.
      </p>
      {state?.supported && (
        <div className="assist-actions">
          {['office', 'blender', 'jmp', 'krita'].map((app) => (
            <label key={app}>
              <input
                type="checkbox"
                disabled={grantSaving}
                checked={state.granted.includes(app)}
                onChange={(e) => void selectGrant(app, e.target.checked)}
              />
              {app === 'office'
                ? 'Word / Excel'
                : app === 'jmp'
                  ? 'JMP'
                  : app === 'krita'
                    ? 'Krita MCP'
                    : 'Blender'}
            </label>
          ))}
        </div>
      )}
      <p>
        Desktop tasks use the selected window above. Drag paths, double-clicks and Ctrl/Shift/Alt
        application shortcuts are available. Shopping covers research/cart preparation only; the
        cart checker does not authorize checkout. Chess includes legal-move/FEN/PGN checking,
        without a bundled playing engine.
      </p>
      <button onClick={() => void run('application:practice')}>
        Open local shopping / chess practice
      </button>
      <div className="assist-actions">
        {state?.applications.map((app: Wire) => (
          <button
            key={app.name}
            disabled={!app.installed}
            title={app.path ?? 'Not detected'}
            onClick={() => void run('application:launch', { application: app.name })}
          >
            Open {app.name}
          </button>
        ))}
      </div>
      <label>
        Task starter{' '}
        <select
          aria-label="Application task starter"
          onChange={(e) => setPrompt(samples[Number(e.target.value)]?.[1] ?? '')}
          defaultValue=""
        >
          <option value="">Choose a workflow</option>
          {samples.map(([name], n) => (
            <option key={name} value={n}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {prompt && (
        <>
          <textarea
            aria-label="Application task"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            disabled={running}
            onClick={() => {
              setRunning(true);
              void run('agent:prompt', { text: prompt }).finally(() => setRunning(false));
            }}
          >
            Run this task with Grok
          </button>
        </>
      )}
      <button onClick={() => void run('application:cancel')}>Stop application job</button>
      {state?.jobs
        .slice()
        .reverse()
        .map((job: Wire) => (
          <article className="narration-job" key={job.id}>
            <strong>{job.application}</strong> · {job.state}
            {job.error && <p role="alert">{job.error}</p>}
            {job.files.map((file: Wire) => (
              <button
                key={file.name}
                onClick={() => void run('application:open', { jobId: job.id, name: file.name })}
              >
                Open {file.name}
              </button>
            ))}
          </article>
        ))}
      <DesktopWorkflowsPanel id={id} />
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
