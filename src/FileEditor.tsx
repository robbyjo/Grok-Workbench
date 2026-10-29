import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { TextDocument } from '../shared/types';
import { highlight } from './syntax';
const CodeEditor = lazy(() => import('./CodeEditor'));

export interface FileDraft extends TextDocument {
  savedText: string;
}
export default function FileEditor({
  id,
  path,
  draft,
  update,
  busy,
  location,
  navigate,
}: {
  id: string;
  path: string;
  draft?: FileDraft;
  update: (draft: FileDraft) => void;
  busy: boolean;
  location?: { line?: number; column?: number };
  navigate: (path: string, location?: { line?: number; column?: number }) => void;
}) {
  const [plain, setPlain] = useState(
    () => localStorage.getItem('workbench-editor-mode') === 'plain',
  );
  const input = useRef<HTMLTextAreaElement>(null),
    overlay = useRef<HTMLPreElement>(null);
  const syntax = useMemo(
    () => (draft ? highlight(draft.text, path) : undefined),
    [draft?.text, path],
  );
  useEffect(() => {
    if (!input.current || !draft || !location?.line) return;
    const lines = input.current.value.split('\n');
    const position =
      lines.slice(0, location.line - 1).reduce((n, line) => n + line.length + 1, 0) +
      (location.column ?? 1) -
      1;
    input.current.focus();
    input.current.setSelectionRange(position, position);
    input.current.scrollTop = Math.max(0, (location.line - 5) * 20);
    if (overlay.current) overlay.current.scrollTop = input.current.scrollTop;
  }, [location, !!draft]);
  const [error, setError] = useState(''),
    [working, setWorking] = useState(false),
    [reload, setReload] = useState(false);
  const current = useRef(draft);
  const lastRendered = useRef(draft);
  const [conflict, setConflict] = useState<TextDocument>();
  if (lastRendered.current !== draft) {
    current.current = draft;
    lastRendered.current = draft;
  }
  const updateCurrent = useRef(update);
  updateCurrent.current = update;
  const operating = useRef(false);
  const diskEpoch = useRef(0);
  function publish(value: FileDraft) {
    current.current = value;
    updateCurrent.current(value);
  }
  const [diskRevision, setDiskRevision] = useState(0);
  useEffect(() => {
    const reconcile = () => setDiskRevision((v) => v + 1);
    const off = window.desktop.onEvent((e) => {
      if (e.type === 'files-changed' && e.id === id) reconcile();
    });
    window.addEventListener('focus', reconcile);
    return () => {
      off();
      window.removeEventListener('focus', reconcile);
    };
  }, [id]);
  useEffect(() => {
    let active = true;
    const epoch = diskEpoch.current;
    void window.desktop
      .call<TextDocument>('files:open', { id, path })
      .then((document) => {
        if (!active || epoch !== diskEpoch.current) return;
        const value = current.current;
        if (value?.text === document.text) {
          setConflict(undefined);
          setError('');
          publish({ ...document, savedText: document.text });
        } else if (value && value.text !== value.savedText) {
          if (value.revision !== document.revision) {
            setConflict(document);
            setError('File changed on disk. Your draft was kept; reload before saving.');
          }
        } else {
          setConflict(undefined);
          setError('');
          publish({ ...document, savedText: document.text });
        }
      })
      .catch((failure) => {
        if (active && epoch === diskEpoch.current) setError((failure as Error).message);
      });
    return () => {
      active = false;
    };
  }, [id, path, diskRevision]);
  const dirty = Boolean(draft && draft.text !== draft.savedText);
  async function save(editorText?: string) {
    const snapshot = current.current;
    if (!snapshot || operating.current || busy) return;
    const text = snapshot.savedText.includes('\r\n')
      ? (editorText ?? snapshot.text).replace(/\r?\n/g, '\r\n')
      : (editorText ?? snapshot.text);
    if (text === snapshot.savedText) return;
    // Keyboard save reads the editor directly, before React has to render its echo.
    publish({ ...snapshot, text });
    operating.current = true;
    diskEpoch.current++;
    setWorking(true);
    setError('');
    try {
      const saved = await window.desktop.call<TextDocument>('files:save', {
        id,
        path,
        text,
        revision: snapshot.revision,
      });
      // Preserve any typing that happened while the save was in flight.
      publish({
        ...saved,
        text: current.current?.text ?? saved.text,
        savedText: saved.text,
      });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      diskEpoch.current++;
      operating.current = false;
      setWorking(false);
    }
  }
  async function reloadFile() {
    if (operating.current) return;
    operating.current = true;
    diskEpoch.current++;
    setWorking(true);
    setError('');
    try {
      const document = await window.desktop.call<TextDocument>('files:open', { id, path });
      publish({ ...document, savedText: document.text });
      setReload(false);
      setConflict(undefined);
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      diskEpoch.current++;
      operating.current = false;
      setWorking(false);
    }
  }
  const change = (text: string) => {
    const snapshot = current.current;
    if (!snapshot) return;
    if (snapshot.savedText.includes('\r\n')) text = text.replace(/\r?\n/g, '\r\n');
    publish({ ...snapshot, text });
  };
  return (
    <div className="file-editor">
      <div className="editor-actions">
        <button
          onClick={() => {
            localStorage.setItem('workbench-editor-mode', plain ? 'code' : 'plain');
            setPlain(!plain);
          }}
        >
          {plain ? 'Use code editor' : 'Use plain text editor'}
        </button>
        <span>
          {dirty ? 'Unsaved draft' : 'Saved'}
          {draft?.savedText.includes('\r\n') ? ' · CRLF' : ' · LF'}
        </span>
        <button disabled={!dirty || working || busy} onClick={() => void save()}>
          Save file
        </button>
        <button
          disabled={working}
          onClick={() => {
            if (dirty) setReload(true);
            else void reloadFile();
          }}
        >
          Reload file
        </button>
      </div>
      {reload && (
        <div className="editor-confirm">
          <p>Discard this draft and reload the current file?</p>
          <button disabled={working} onClick={() => void reloadFile()}>
            Discard draft and reload
          </button>
          <button onClick={() => setReload(false)}>Keep draft</button>
        </div>
      )}
      {error && (
        <div className="panel-error" role="alert">
          {error}
        </div>
      )}
      {draft && conflict && (
        <details className="disk-comparison">
          <summary>Compare disk change with draft</summary>
          <strong>Last saved version</strong>
          <pre>{draft.savedText}</pre>
          <strong>Current disk version</strong>
          <pre>{conflict.text}</pre>
          <strong>Your preserved draft</strong>
          <pre>{draft.text}</pre>
        </details>
      )}
      {draft && !plain && (
        <Suspense fallback={<p role="status">Loading code editor…</p>}>
          <CodeEditor
            id={id}
            path={path}
            text={draft.text}
            change={change}
            save={(text) => void save(text)}
            location={location}
            navigate={navigate}
          />
        </Suspense>
      )}
      {draft && plain && (
        <div className={`syntax-editor ${syntax === undefined ? '' : 'highlighted'}`}>
          {syntax !== undefined && (
            <pre ref={overlay} className="syntax-overlay" aria-hidden="true">
              <code dangerouslySetInnerHTML={{ __html: syntax }} />
            </pre>
          )}
          <textarea
            ref={input}
            className="file-preview file-edit-text"
            aria-label={`Edit ${path}`}
            spellCheck={false}
            value={draft.text}
            onChange={(event) => change(event.target.value)}
            onScroll={(event) => {
              if (overlay.current) {
                overlay.current.scrollTop = event.currentTarget.scrollTop;
                overlay.current.scrollLeft = event.currentTarget.scrollLeft;
              }
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                void save(event.currentTarget.value);
              }
              if (
                event.key === 'Tab' &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !event.shiftKey
              ) {
                event.preventDefault();
                const input = event.currentTarget,
                  start = input.selectionStart,
                  end = input.selectionEnd;
                change(input.value.slice(0, start) + '\t' + input.value.slice(end));
                queueMicrotask(() => input.setSelectionRange(start + 1, start + 1));
              }
            }}
          />
        </div>
      )}
      <small className="editor-help">
        Ctrl+S saves. Drafts survive switching files/chats while the app is open. Saves check for
        external changes.
      </small>
    </div>
  );
}
