// Text extraction for written requirement sources (PRDs, briefs, specs) that
// arrive as office files: PDF, Word, PowerPoint, Excel, OpenDocument, RTF…

export type DocumentInput = { filename: string; data: Buffer };

export type DocumentText = {
  text: string; // Markdown: headings, lists and tables kept
  format: string; // detected format, e.g. "pdf", "docx"
};

export class DocumentReadError extends Error {
  constructor(public code: 'unsupported' | 'no_text' | 'encrypted' | 'failed', message: string) {
    super(message);
  }
}

export interface DocumentReaderPort {
  read(doc: DocumentInput): Promise<DocumentText>;
}
