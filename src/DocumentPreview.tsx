import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Wire } from '../shared/types';
import { t } from '../shared/i18n';

export const previewable = (path: string) =>
  /\.(?:pdf|docx|xlsx|pptx|md|png|jpe?g|gif|webp|mp[34]|m4a|wav|ogg|webm)$/i.test(path);
export default function DocumentPreview({
  id,
  path,
  assetId,
}: {
  id?: string;
  path?: string;
  assetId?: string;
}) {
  const [value, setValue] = useState<Wire>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true,
      objectUrl = '';
    setValue(undefined);
    setError('');
    setUrl('');
    void window.desktop
      .call<Wire>('preview:file', { id, path, assetId })
      .then((v) => {
        if (!alive) return;
        if (v.data) {
          const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0));
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: v.mimeType }));
          setUrl(objectUrl);
        }
        setValue(v);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, path, assetId, revision]);
  return (
    <section className="document-preview" aria-label={t('Document preview')}>
      <button onClick={() => setRevision((v) => v + 1)}>{t('Refresh preview')}</button>
      {error && <p role="alert">{error}</p>}
      {!value && !error && <p role="status">{t('Loading preview…')}</p>}
      {value?.kind === 'image' && <img src={url} alt={path ?? t('Attached image')} />}
      {value?.kind === 'audio' && <audio src={url} controls preload="metadata" />}
      {value?.kind === 'video' && <video src={url} controls preload="metadata" />}
      {value?.kind === 'pdf' && <PdfPreview data={value.data} />}
      {value?.kind === 'markdown' && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href && /^https?:\/\//i.test(href))
                    void window.desktop.call('external:open', { url: href });
                }}
              >
                {children}
              </a>
            ),
            img: ({ alt }) => <span>{alt}</span>,
          }}
        >
          {value.text}
        </ReactMarkdown>
      )}
      {value?.kind === 'text' && <pre>{value.text}</pre>}
      {value?.kind === 'office' && (
        <>
          <p className="muted">{t(value.notice)}</p>
          {value.sections.map((s: Wire, i: number) => (
            <section key={i}>
              <h4>{s.title}</h4>
              {s.paragraphs?.map((p: string, n: number) => (
                <p key={n}>{p}</p>
              ))}
              {s.rows && (
                <div className="preview-table">
                  <table>
                    <tbody>
                      {s.rows.map((r: string[], n: number) => (
                        <tr key={n}>
                          <th scope="row">{s.rowNumbers?.[n] ?? n + 1}</th>
                          {r.map((c, j) => (
                            <td key={j}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
          {value.truncated && (
            <p role="status">
              {t('Preview limit reached. Open the original document for all content.')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
function PdfPreview({ data }: { data: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState('');
  const document = useRef<any>(undefined);
  useEffect(() => {
    let alive = true,
      task: any;
    setTotal(0);
    setPage(1);
    setError('');
    void (async () => {
      const pdf = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
      if (!alive) return;
      pdf.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdf.getDocument({
        data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
        useSystemFonts: true,
        useWasm: false,
        disableFontFace: false,
        maxImageSize: 16000000,
        stopAtErrors: true,
      });
      const value = await task.promise;
      if (alive) {
        document.current = value;
        setPage(1);
        setTotal(value.numPages);
      }
    })().catch((e) => {
      if (alive) setError(String(e));
    });
    return () => {
      alive = false;
      document.current = undefined;
      void task?.destroy();
    };
  }, [data]);
  useEffect(() => {
    let alive = true,
      render: any;
    void (async () => {
      if (!document.current || !canvas.current) return;
      const p = await document.current.getPage(page);
      if (!alive || !canvas.current) return;
      const initial = p.getViewport({ scale: 1 });
      const scale = Math.min(1.5, 1200 / initial.width, 1600 / initial.height);
      const viewport = p.getViewport({ scale });
      const target = canvas.current;
      target.width = viewport.width;
      target.height = viewport.height;
      render = p.render({ canvas: target, canvasContext: target.getContext('2d')!, viewport });
      await render.promise;
    })().catch((e) => {
      if (alive && e.name !== 'RenderingCancelledException') setError(String(e));
    });
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [page, total]);
  return (
    <div>
      <div className="input-row">
        <button disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
          {t('Previous page')}
        </button>
        <span>
          {page} / {total}
        </span>
        <button disabled={page >= total} onClick={() => setPage((v) => v + 1)}>
          {t('Next page')}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <canvas ref={canvas} aria-label={`${t('PDF page')} ${page}`} />
    </div>
  );
}
