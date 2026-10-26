import { describe, it, expect } from 'vitest';
import { OfficeConverter } from 'officeparser';
import { OfficeDocumentReader, cleanMarkdown } from './OfficeDocumentReader';
import { DocumentReadError } from '../../../domain/ports/out/DocumentReaderPort';

const PRD = '# Checkout PRD\n\n## Requirements\n\n- Users must reset their password by email.\n- Export orders as CSV.\n\n| Field | Rule |\n|---|---|\n| email | required |\n';

// Real documents, generated from Markdown so the test needs no binary fixtures.
const generate = async (format: 'docx' | 'odt' | 'rtf') =>
  Buffer.from((await OfficeConverter.convert(Buffer.from(PRD), format, { parseConfig: { fileType: 'md' } })).value as unknown as Uint8Array);

// A minimal one-page PDF with a text layer (or none, for a "scanned" page).
function pdf(lines: string[]): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map(l => `(${l}) '`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const reader = new OfficeDocumentReader();
const readError = (filename: string, data: Buffer) => reader.read({ filename, data }).then(() => null, (e: DocumentReadError) => e);

describe('OfficeDocumentReader', () => {
  it.each(['docx', 'odt', 'rtf'] as const)('reads a .%s as Markdown, keeping headings, lists and tables', async format => {
    const doc = await reader.read({ filename: `prd.${format}`, data: await generate(format) });
    expect(doc.format).toBe(format);
    expect(doc.text).toContain('# Checkout PRD');
    expect(doc.text).toContain('- Users must reset their password by email.');
    expect(doc.text).toMatch(/\| email \| required \|/);
    expect(doc.text).not.toContain('{#'); // no heading anchors
    expect(doc.text.startsWith('---')).toBe(false); // no metadata front matter
  });

  it('reads the text layer of a PDF', async () => {
    const doc = await reader.read({ filename: 'Brief.PDF', data: pdf(['Checkout brief', 'Users must reset their password by email.']) });
    expect(doc.format).toBe('pdf');
    expect(doc.text).toContain('Users must reset their password by email.');
  });

  it('explains a scanned PDF with no text', async () => {
    const err = await readError('scan.pdf', pdf([]));
    expect(err).toBeInstanceOf(DocumentReadError);
    expect(err!.code).toBe('no_text');
    expect(err!.message).toContain('scanned');
  });

  it('asks for .docx instead of the legacy .doc format', async () => {
    const err = await readError('old.doc', Buffer.from('x'));
    expect(err!.code).toBe('unsupported');
    expect(err!.message).toContain('.docx');
  });

  it('rejects unknown formats and corrupt files', async () => {
    expect((await readError('photo.png', Buffer.from('x')))!.code).toBe('unsupported');
    const corrupt = await readError('prd.docx', Buffer.from('not a zip'));
    expect(corrupt!.code).toBe('failed');
    expect(corrupt!.message).toMatch(/^Couldn’t read prd\.docx: /);
  });
});

describe('cleanMarkdown', () => {
  it('drops front matter and page separators with nothing between them', () => {
    expect(cleanMarkdown('---\nIsLinearized: false\n---\n\n---')).toBe('');
    expect(cleanMarkdown('---\ncreated: x\n---\n\n# A\n\n\n\nB\n')).toBe('# A\n\nB');
  });
});
