import { useState } from 'react';
import type { UserQuestion } from '../shared/types';
export default function UserQuestions({ question }: { question: UserQuestion }) {
  const [answers, setAnswers] = useState(
    question.questions.map(() => ({ selected: [] as string[], notes: '' })),
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(cancel = false) {
    setBusy(true);
    try {
      await window.desktop.call('question:answer', { questionId: question.id, answers, cancel });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }
  return (
    <section className="permission-card user-questions" aria-label="Grok questions">
      <strong>Grok needs your input</strong>
      {question.questions.map((q, index) => (
        <fieldset key={index} disabled={busy}>
          <legend>{q.question}</legend>
          {q.options.map((option) => (
            <label key={option.label}>
              <input
                type={q.multiSelect ? 'checkbox' : 'radio'}
                name={question.id + index}
                checked={answers[index].selected.includes(option.label)}
                onChange={() =>
                  setAnswers((rows) =>
                    rows.map((row, i) =>
                      i !== index
                        ? row
                        : {
                            ...row,
                            selected: q.multiSelect
                              ? row.selected.includes(option.label)
                                ? row.selected.filter((v) => v !== option.label)
                                : [...row.selected, option.label]
                              : [option.label],
                          },
                    ),
                  )
                }
              />{' '}
              {option.label}
              {option.description && <small>{option.description}</small>}
              {option.preview && (
                <details>
                  <summary>Preview {option.label}</summary>
                  <pre>{option.preview}</pre>
                </details>
              )}
            </label>
          ))}
          <label>
            Additional answer or notes
            <textarea
              aria-label={`Answer: ${q.question}`}
              maxLength={10000}
              value={answers[index].notes}
              onChange={(e) =>
                setAnswers((rows) =>
                  rows.map((row, i) => (i === index ? { ...row, notes: e.target.value } : row)),
                )
              }
            />
          </label>
        </fieldset>
      ))}
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy || answers.some((a) => !a.selected.length && !a.notes.trim())}
        onClick={() => void submit()}
      >
        Send answers
      </button>
      <button disabled={busy} onClick={() => void submit(true)}>
        Cancel questions
      </button>
    </section>
  );
}
