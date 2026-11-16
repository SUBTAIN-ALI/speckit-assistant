import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { knowledgeHandlers } from '../../../../../adapters/chatbot-di';
import { getWorkspacePath } from '../../../../../adapters/primary/api/utils';

const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let tmpPath: string | null = null;
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `File exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)` }, { status: 400 });
    }

    const tmpDir = path.join(os.tmpdir(), 'specrabbit-upload');
    await fs.mkdir(tmpDir, { recursive: true });
    tmpPath = path.join(tmpDir, `${crypto.randomUUID()}-${file.name}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(tmpPath, buffer);

    const workspacePath = getWorkspacePath();
    const result = await knowledgeHandlers.upload(workspacePath, tmpPath, file.name);

    return NextResponse.json({ text: result.text, format: result.format, filename: file.name });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Upload failed' }, { status: 500 });
  } finally {
    if (tmpPath) {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }
}
