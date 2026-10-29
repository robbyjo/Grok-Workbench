import { useState } from 'react';
import type { TurnEdit } from '../shared/turn-review';
export default function TurnReview({ id, turn }: { id: string; turn: string }) {
  const [report, setReport] = useState<{ edits: TurnEdit[]; truncated: boolean }>();
  const [error, setError] = useState('');
  return (
    <details
      className="turn-review"
      onToggle={async (e) => {
        if (!e.currentTarget.open) return;
        try {
          setReport(await window.desktop.call('review:turn', { id, turn }));
          setError('');
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <summary>Changes from this turn</summary>
      <p>
        Completed file edits reported by Grok. Shell commands and external writers may make
        additional changes; review repository Changes too.
      </p>
      {error && <p role="alert">{error}</p>}
      {report?.truncated && (
        <p role="status">
          Review shortened at its storage/display limit. Export the transcript for the remaining
          reported edits.
        </p>
      )}
      {report && !report.edits.length && <p>No file edits reported for this turn.</p>}
      {report?.edits.map((edit, i) => (
        <details key={i} open>
          <summary>{edit.path}</summary>
          <div className="turn-edit-versions">
            <div>
              <strong>Before{edit.before === null ? ' (new file or unavailable)' : ''}</strong>
              <pre>{edit.before ?? ''}</pre>
            </div>
            <div>
              <strong>After</strong>
              <pre>{edit.after}</pre>
            </div>
          </div>
        </details>
      ))}
    </details>
  );
}
