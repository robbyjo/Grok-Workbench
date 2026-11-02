import { useEffect, useRef, useState } from 'react';
import type { Wire } from '../shared/types';
import WorkstationPanel from './WorkstationPanel';

function NarrationPlayer({ job, id }: { job: Wire; id: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(['preparing', 'generating'].includes(job.state)),
    [error, setError] = useState('');
  const asset = job.assets[index];
  useEffect(() => {
    const element = audio.current;
    if (!element || !asset || !playing) return;
    void element.play().catch(() => {
      setPlaying(false);
      setError('Press Play to start audio.');
    });
  }, [asset?.id, playing]);
  useEffect(() => {
    if (job.playback === 'pause' || job.playback === 'stop') {
      audio.current?.pause();
      setPlaying(false);
    }
    if (job.playback === 'resume') {
      setPlaying(true);
      setError('');
    }
  }, [job.playbackRevision]);
  const control = (action: string) =>
    window.desktop
      .call('narration:control', { id, jobId: job.id, action })
      .catch((e) => setError(String(e)));
  return (
    <article className="narration-job">
      <strong>{job.title}</strong>
      <p role="status">
        {job.state} · {job.completed}/{job.total} segments ready
      </p>
      {job.error && <p role="alert">{job.error}</p>}
      {asset && (
        <>
          <p>
            Segment {index + 1} of {job.total}
          </p>
          <audio
            ref={audio}
            controls
            src={asset.url}
            onPlay={() => {
              setPlaying(true);
              setError('');
            }}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setIndex((v) => v + 1);
              setPlaying(true);
            }}
          />
          <button
            onClick={() =>
              void window.desktop
                .call('media:export', { assetId: asset.id })
                .catch((e) => setError(String(e)))
            }
          >
            Export this segment
          </button>
        </>
      )}
      {!asset && index > 0 && job.state === 'complete' && (
        <button
          onClick={() => {
            setIndex(0);
            setPlaying(true);
          }}
        >
          Replay
        </button>
      )}
      <div className="assist-actions">
        <button onClick={() => void control('pause')}>Pause</button>
        <button onClick={() => void control('resume')}>Resume</button>
        <button onClick={() => void control('stop')}>Stop reading</button>
      </div>
      {job.assets.length > 1 && (
        <label>
          Segment{' '}
          <select
            value={Math.min(index, job.assets.length - 1)}
            onChange={(e) => {
              setIndex(Number(e.target.value));
              setPlaying(true);
            }}
          >
            {job.assets.map((a: Wire, n: number) => (
              <option key={a.id} value={n}>
                {n + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="status">{error}</p>}
    </article>
  );
}
export default function AssistTools({ id }: { id: string }) {
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState<Wire>(),
    [windows, setWindows] = useState<Wire[]>([]),
    [target, setTarget] = useState(''),
    [error, setError] = useState('');
  const [kind, setKind] = useState('text'),
    [source, setSource] = useState(''),
    [voice, setVoice] = useState('eve'),
    [start, setStart] = useState(''),
    [end, setEnd] = useState('');
  const [inputStatus, setInputStatus] = useState<Wire>();
  const previousJobs = useRef(0);
  useEffect(() => {
    if ((status?.jobs.length ?? 0) > previousJobs.current) setOpen(false);
    previousJobs.current = status?.jobs.length ?? 0;
  }, [status?.jobs.length]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void window.desktop
        .call<Wire>('assist:status', { id })
        .then((v) => {
          if (alive) setStatus(v);
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    refresh();
    const off = window.desktop.onEvent((e) => {
      if (e.type === 'assist-changed') refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [id]);
  const run = async (method: string, args: Wire = {}) => {
    setError('');
    try {
      return await window.desktop.call(method, { id, ...args });
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="assist-tools" aria-label="Desktop and read aloud">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Desktop &amp; read aloud {status?.desktop.enabled ? '· window enabled' : ''}
      </button>
      {(status?.desktop.enabled || status?.desktop.enabling) && (
        <button className="danger" onClick={() => void run('desktop:stop')}>
          Stop desktop (Ctrl+Alt+Escape)
        </button>
      )}
      {open && (
        <div className="assist-panel">
          <WorkstationPanel id={id} />
          {status?.desktop.supported ? (
            <>
              <h3>Windows desktop control</h3>
              <button
                onClick={() =>
                  void run('desktop:input-status').then((v) => {
                    if (v) setInputStatus(v);
                  })
                }
              >
                Check desktop input
              </button>
              {inputStatus && (
                <p role="status">
                  {inputStatus.foregroundAvailable
                    ? 'Foreground input is available.'
                    : 'Windows is not exposing foreground input to this process.'}{' '}
                  Station: {inputStatus.windowStation}; process desktop: {inputStatus.threadDesktop}
                  ; input desktop: {inputStatus.inputDesktop}.
                </p>
              )}
              <p>
                Choose one window for this chat. Grok can capture it, inspect controls and send
                keyboard/mouse input in the foreground. Screen content is sent to the chat model.
                Elevated/protected apps are unsupported. Stop revokes access immediately.
              </p>
              <button
                onClick={() =>
                  void run('desktop:windows').then((v) => {
                    if (v) setWindows(v);
                  })
                }
              >
                Refresh windows
              </button>
              <select
                aria-label="Desktop target window"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose a window</option>
                {windows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title} ({w.process})
                  </option>
                ))}
              </select>
              <button disabled={!target} onClick={() => void run('desktop:enable', { target })}>
                Enable for this chat
              </button>
              {status.desktop.enabled && (
                <p role="status">
                  Enabled: {status.desktop.title}. Ask Grok to use workbench desktop tools.
                </p>
              )}
            </>
          ) : (
            <p>Desktop control requires Windows.</p>
          )}
          <h3>Read aloud</h3>
          <p>
            Ask Grok to read text, a PDF, or a Word DOCX aloud, or start here. Extracted text is
            sent to xAI speech using your current account. English voices; scanned PDFs need OCR;
            convert older .doc files to .docx. Generated audio is also saved in Media.
          </p>
          <label>
            Source{' '}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setSource('');
              }}
            >
              <option value="text">Text</option>
              <option value="path">Workspace file path</option>
              <option value="asset_id">Stored attachment</option>
            </select>
          </label>
          {kind === 'asset_id' ? (
            <select
              aria-label="Read aloud attachment"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Choose attachment</option>
              {status?.attachments.map((a: Wire) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              aria-label="Read aloud source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={
                kind === 'text'
                  ? 'Text to read verbatim'
                  : 'Path inside this chat workspace, e.g. report.pdf'
              }
            />
          )}
          <label>
            Voice{' '}
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {['eve', 'ara', 'leo', 'rex', 'sal'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {kind !== 'text' && (
            <div>
              <label>
                PDF start page{' '}
                <input
                  type="number"
                  min="1"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                End page{' '}
                <input type="number" min="1" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
          )}
          <button
            disabled={!source.trim()}
            onClick={() =>
              void run('narration:start', {
                source: {
                  [kind]: source,
                  voice,
                  ...(start ? { start_page: Number(start) } : {}),
                  ...(end ? { end_page: Number(end) } : {}),
                },
              })
            }
          >
            Read aloud
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {status?.jobs.slice(-1).map((job: Wire) => (
        <NarrationPlayer key={job.id} job={job} id={id} />
      ))}
      {status && status.jobs.length > 1 && (
        <details>
          <summary>Previous readings ({status.jobs.length - 1})</summary>
          {status.jobs
            .slice(0, -1)
            .reverse()
            .map((job: Wire) => (
              <NarrationPlayer key={job.id} job={job} id={id} />
            ))}
        </details>
      )}
    </section>
  );
}
