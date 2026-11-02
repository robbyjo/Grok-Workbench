import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} from 'pdf-lib';
import type { Wire } from '../../shared/types';
import { workspaceFile, list, bounded, save } from './io';
export async function pdfWorkflow(root: string, out: string, input: Wire) {
  const files = await Promise.all(list<string>(input.paths, 10).map((p) => workspaceFile(root, p)));
  if (files.some((f) => !f.path.toLowerCase().endsWith('.pdf')))
    throw new Error('Choose PDF files.');
  const docs = await Promise.all(files.map((f) => PDFDocument.load(f.bytes)));
  if (docs.some((d) => d.getPageCount() > 100))
    throw new Error('At most 100 pages per source PDF.');
  if (input.action === 'inspect')
    return {
      result: {
        pages: docs.map((d) => d.getPageCount()),
        fields: docs[0]
          .getForm()
          .getFields()
          .map((f) => ({ name: f.getName(), type: f.constructor.name })),
        sources: files.map((f) => ({ path: f.path, sha256: f.sha256 })),
      },
      files: [],
    };
  let doc = docs[0];
  const artifacts: Wire[] = [];
  if (input.action === 'merge') {
    doc = await PDFDocument.create();
    for (const source of docs) {
      const pages = await doc.copyPages(source, source.getPageIndices());
      for (const page of pages) doc.addPage(page);
      if (doc.getPageCount() > 200) throw new Error('Merged PDF exceeds 200 pages.');
    }
  } else if (input.action === 'split') {
    for (const pageNumber of list<number>(input.pages, 100)) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.getPageCount())
        throw new Error('Invalid 1-based PDF page.');
      const piece = await PDFDocument.create();
      piece.addPage((await piece.copyPages(doc, [pageNumber - 1]))[0]);
      artifacts.push(await save(out, `page-${pageNumber}.pdf`, await piece.save()));
    }
    return { result: { pages: input.pages }, files: artifacts };
  } else if (input.action === 'select') {
    const selected = await PDFDocument.create();
    const indices = list<number>(input.pages, 100).map((n) => {
      if (!Number.isInteger(n) || n < 1 || n > doc.getPageCount())
        throw new Error('Invalid 1-based PDF page.');
      return n - 1;
    });
    for (const page of await selected.copyPages(doc, indices)) selected.addPage(page);
    doc = selected;
  } else if (input.action === 'fill') {
    const form = doc.getForm();
    const fields = Array.isArray(input.fields)
      ? Object.fromEntries(input.fields.map((f: Wire) => [f.name, f.checked ?? f.value]))
      : (input.fields ?? {});
    for (const [name, value] of Object.entries(fields)) {
      const field = form.getField(name);
      if (field instanceof PDFTextField) field.setText(String(value).slice(0, 10000));
      else if (field instanceof PDFCheckBox) {
        if (typeof value !== 'boolean') throw new Error('Checkbox value must be boolean.');
        value ? field.check() : field.uncheck();
      } else if (
        field instanceof PDFDropdown ||
        field instanceof PDFRadioGroup ||
        field instanceof PDFOptionList
      )
        field.select(String(value));
      else throw new Error('Unsupported form field.');
    }
    if (input.flatten === true) form.flatten();
  } else if (input.action === 'annotate') {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const mark of list<Wire>(input.annotations, 100)) {
      if (!Number.isInteger(mark.page) || mark.page < 1 || mark.page > doc.getPageCount())
        throw new Error('Invalid annotation page.');
      const page = doc.getPage(mark.page - 1),
        x = bounded(mark.x, 0, page.getWidth()),
        y = bounded(mark.y, 0, page.getHeight());
      if (mark.text !== undefined)
        page.drawText(String(mark.text).slice(0, 2000), {
          x,
          y,
          font,
          size: bounded(mark.size ?? 12, 6, 72),
          color: rgb(0.1, 0.1, 0.1),
          maxWidth: page.getWidth() - x,
        });
      else
        page.drawRectangle({
          x,
          y,
          width: bounded(mark.width, 1, page.getWidth() - x),
          height: bounded(mark.height, 1, page.getHeight() - y),
          color: rgb(1, 0.9, 0),
          opacity: 0.3,
        });
    }
  } else if (input.action !== 'merge')
    throw new Error('Choose inspect, merge, split, select, fill or annotate.');
  artifacts.push(await save(out, 'result.pdf', await doc.save()));
  return {
    result: {
      pages: doc.getPageCount(),
      sourceHashes: files.map((f) => f.sha256),
      notice:
        'Annotations are visible overlays, not redaction. Coordinates use PDF points from bottom-left.',
    },
    files: artifacts,
  };
}
