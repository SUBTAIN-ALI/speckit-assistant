import type { SupportedFileType } from 'officeparser';
import { DocumentInput, DocumentReadError, DocumentReaderPort, DocumentText } from '../../../domain/ports/out/DocumentReaderPort';
import { extensionOf } from '../../../domain/services/transcript';

// officeparser turns the document into an AST, which is rendered as Markdown so
// the model still sees headings, lists and tables. pdf.js runs in a child
// process, so the timeout also ends a PDF that is stuck mid-parse.

const PARSE_TIMEOUT_MS = 60_000;

const FILE_TYPES: Record<string, SupportedFileType> = {
  pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', odt: 'odt', odp: 'odp', ods: 'ods',
  rtf: 'rtf', html: 'html', htm: 'html', epub: 'epub',
};

const LEGACY: Record<string, string> = { doc: '.docx', ppt: '.pptx', xls: '.xlsx' };

export class OfficeDocumentReader implements DocumentReaderPort {
  constructor(private timeoutMs = PARSE_TIMEOUT_MS) {}

  async read({ filename, data }: DocumentInput): Promise<DocumentText> {
    const ext = extensionOf(filename);
    if (LEGACY[ext]) {
      throw new DocumentReadError('unsupported', `${filename} is in the old binary Office format. Open it and save it as ${LEGACY[ext]} (or export a PDF), then upload that.`);
    }
    const fileType = FILE_TYPES[ext];
    if (!fileType) throw new DocumentReadError('unsupported', `${filename} isn’t a supported document. Upload a PDF, Word, PowerPoint, Excel, OpenDocument, RTF, HTML or EPUB file.`);

    // Loaded on first use: it is large, and needs Node 22.13+.
    const { OfficeParser } = await import('officeparser');
    let markdown: string;
    try {
      const ast = await OfficeParser.parseOffice(data, {
        fileType,
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
      markdown = (await ast.to('md', { generateIds: false, ignoreInternalLinks: true, includeImages: false })).value as string;
    } catch (err) {
      throw this.toReadError(filename, err);
    }

    const text = cleanMarkdown(markdown);
    if (!text) {
      throw new DocumentReadError('no_text', fileType === 'pdf'
        ? `No text found in ${filename}. It looks like a scanned PDF (images only), which isn’t supported yet. Export it with a text layer (or run OCR on it) and upload it again.`
        : `No text found in ${filename}.`);
    }
    return { text, format: fileType };
  }

  private toReadError(filename: string, err: unknown): DocumentReadError {
    const e = err as { name?: string; message?: string; officeIssue?: { code?: string } };
    const code = e.officeIssue?.code;
    if (e.name === 'AbortError' || e.name === 'TimeoutError' || code === 'OPERATION_ABORTED') {
      return new DocumentReadError('failed', `Reading ${filename} took longer than ${Math.round(this.timeoutMs / 1000)} seconds and was stopped.`);
    }
    if (code === 'PASSWORD_REQUIRED' || code === 'PASSWORD_INCORRECT' || code === 'DOCUMENT_DECRYPTION_FAILED') {
      return new DocumentReadError('encrypted', `${filename} is password-protected. Remove the password and upload it again.`);
    }
    const detail = (e.message ?? String(err)).replace(/^\[OfficeParser\]:\s*/, '');
    return new DocumentReadError('failed', `Couldn’t read ${filename}: ${detail}`);
  }
}

// Drops officeparser's YAML front matter (file metadata) and the page/slide
// separators that would remain on their own once a document has no text.
export function cleanMarkdown(markdown: string): string {
  const body = markdown.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  if (!body.split('\n').some(l => l.trim() && l.trim() !== '---')) return '';
  return body.replace(/\n{3,}/g, '\n\n').trim();
}
