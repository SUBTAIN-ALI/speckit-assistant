import * as fs from 'fs/promises';
import * as path from 'path';

export type SupportedFormat = 'pdf' | 'docx' | 'md' | 'txt';

export interface DocumentExtractor {
  extract(filePath: string, format: SupportedFormat): Promise<string>;
  detectFormat(filename: string): SupportedFormat | null;
}

const FORMAT_MAP: Record<string, SupportedFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.md': 'md',
  '.txt': 'txt',
  '.markdown': 'md',
  '.text': 'txt',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export class FSDocumentExtractor implements DocumentExtractor {
  detectFormat(filename: string): SupportedFormat | null {
    const ext = path.extname(filename).toLowerCase();
    return FORMAT_MAP[ext] ?? null;
  }

  async extract(filePath: string, format: SupportedFormat): Promise<string> {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds 10MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    }

    switch (format) {
      case 'md':
      case 'txt':
        return fs.readFile(filePath, 'utf-8');

      case 'docx':
        return this.extractDocx(filePath);

      case 'pdf':
        return this.extractPdf(filePath);
    }
  }

  private async extractDocx(filePath: string): Promise<string> {
    const { OfficeDocumentReader } = await import('../../adapters/secondary/docs/OfficeDocumentReader');
    const reader = new OfficeDocumentReader();
    const data = await fs.readFile(filePath);
    const filename = path.basename(filePath);
    const result = await reader.read({ filename, data });
    return result.text;
  }

  private async extractPdf(filePath: string): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = (await import(/* webpackIgnore: true */ 'pdf-parse' as string)).default as (buf: Buffer) => Promise<{ text: string }>;
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    } catch (err: any) {
      if (err.code === 'MODULE_NOT_FOUND') {
        throw new Error('PDF extraction requires the pdf-parse package. Install it with: npm install pdf-parse');
      }
      throw new Error(`Failed to extract PDF: ${err.message}`);
    }
  }
}
