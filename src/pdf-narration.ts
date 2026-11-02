import type { DesktopAPI } from '../shared/types';

export async function extractPdfText(data: string, start = 1, end?: number) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
    useWorkerFetch: false,
  });
  const deadline = setTimeout(() => {
    void task.destroy();
  }, 25000);
  // Password callbacks otherwise leave the task waiting indefinitely.
  task.onPassword = () => {
    void task.destroy();
  };
  try {
    const pdf = await task.promise;
    const last = end ?? pdf.numPages;
    if (start > pdf.numPages || last > pdf.numPages || last - start >= 100)
      throw new Error('Choose an existing PDF page range of at most 100 pages.');
    const pages: string[] = [];
    let length = 0;
    for (let n = start; n <= last; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      length += text.length + 2;
      if (length > 120000)
        throw new Error('PDF text exceeds 120,000 characters. Choose a smaller page range.');
      pages.push(text);
      page.cleanup();
    }
    if (!pages.some((p) => p.trim()))
      throw new Error('This PDF contains no extractable text. Run OCR first.');
    return pages.join('\n\n');
  } finally {
    clearTimeout(deadline);
    await task.destroy();
  }
}
export function installPdfNarration(api: DesktopAPI) {
  return api.onEvent((event) => {
    if (event.type !== 'narration-pdf') return;
    void extractPdfText(event.data, event.start, event.end)
      .then(
        (text) => api.call('narration:pdf-result', { requestId: event.id, text }),
        (e) =>
          api.call('narration:pdf-result', {
            requestId: event.id,
            error: `PDF extraction failed: ${String(e).slice(0, 350)}. Password-protected PDFs must be unlocked first.`,
          }),
      )
      .catch(() => {});
  });
}
