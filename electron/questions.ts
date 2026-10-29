import type { UserQuestion, Wire } from '../shared/types';

export function questions(input: Wire): UserQuestion['questions'] {
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 10)
    throw new Error('Invalid question list.');
  const seen = new Set<string>();
  return input.questions.map((q: Wire) => {
    if (
      typeof q.question !== 'string' ||
      !q.question.trim() ||
      q.question.length > 10000 ||
      seen.has(q.question)
    )
      throw new Error('Invalid or duplicate question.');
    seen.add(q.question);
    if (!Array.isArray(q.options) || q.options.length > 20)
      throw new Error('Invalid question options.');
    const labels = new Set<string>();
    const options = q.options.map((o: Wire) => {
      if (
        typeof o.label !== 'string' ||
        !o.label.trim() ||
        o.label.length > 1000 ||
        labels.has(o.label)
      )
        throw new Error('Invalid or duplicate option.');
      labels.add(o.label);
      for (const key of ['description', 'preview'])
        if (
          o[key] !== undefined &&
          o[key] !== null &&
          (typeof o[key] !== 'string' || o[key].length > 40000)
        )
          throw new Error('Invalid option text.');
      return { label: o.label, description: o.description, preview: o.preview };
    });
    return {
      question: q.question,
      multiSelect: q.multiSelect === true || q.multi_select === true,
      options,
    };
  });
}

export function questionReply(question: UserQuestion, input: Wire): Wire {
  if (input.cancel === true) return { outcome: 'cancelled' };
  if (!Array.isArray(input.answers) || input.answers.length !== question.questions.length)
    throw new Error('Answer every question or cancel.');
  const answers: Record<string, string[]> = Object.create(null);
  const annotations: Record<string, Wire> = Object.create(null);
  question.questions.forEach((q, index) => {
    const row = input.answers[index];
    if (
      !row ||
      !Array.isArray(row.selected) ||
      row.selected.length > q.options.length ||
      new Set(row.selected).size !== row.selected.length ||
      row.selected.some((label: unknown) => !q.options.some((o) => o.label === label)) ||
      (!q.multiSelect && row.selected.length > 1) ||
      typeof row.notes !== 'string' ||
      row.notes.length > 10000 ||
      row.notes.includes('\0')
    )
      throw new Error('Invalid question answer.');
    if (!row.selected.length && !row.notes.trim())
      throw new Error('Answer every question or cancel.');
    answers[q.question] = row.selected.length ? row.selected : ['Other'];
    const preview =
      row.selected.length === 1
        ? q.options.find((o) => o.label === row.selected[0])?.preview
        : undefined;
    annotations[q.question] = {
      ...(row.notes.trim() ? { notes: row.notes } : {}),
      ...(preview ? { preview } : {}),
    };
  });
  return { outcome: 'accepted', answers, annotations };
}
