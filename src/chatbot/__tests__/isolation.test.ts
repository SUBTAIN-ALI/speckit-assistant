import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CHATBOT_SRC = path.resolve(__dirname, '..');
const FORBIDDEN_IMPORT_DIRS = ['src/domain/', 'src/adapters/', 'src/components/'];

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Chatbot Module Isolation', () => {
  it('chatbot source files do not import from main src/domain/', () => {
    const files = collectTsFiles(CHATBOT_SRC);
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*import\s/.test(line)) {
          const match = line.match(/from\s+['"]([^'"]+)['"]/);
          if (match) {
            const importPath = match[1];
            // Allow imports from within chatbot, from node builtins, and from shared lib utilities
            if (importPath.startsWith('.') || importPath.startsWith('..')) {
              const resolved = path.resolve(path.dirname(file), importPath);
              const relativeToChatbot = path.relative(CHATBOT_SRC, resolved);
              if (relativeToChatbot.startsWith('..')) {
                const relativeToSrc = path.relative(path.resolve(CHATBOT_SRC, '..'), resolved);
                for (const forbidden of ['domain/', 'adapters/secondary/', 'adapters/primary/']) {
                  if (relativeToSrc.startsWith(forbidden)) {
                    violations.push(`${path.relative(CHATBOT_SRC, file)}:${i + 1} imports from main ${forbidden}: "${importPath}"`);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Allow specific shared utility imports: MarkdownPreview, ChatMarkdownRenderer, readSse, sse helper
    const filtered = violations.filter(v =>
      !v.includes('components/MarkdownPreview') &&
      !v.includes('components/ChatMarkdownRenderer') &&
      !v.includes('components/chat/') &&
      !v.includes('lib/sse') &&
      !v.includes('adapters/primary/api/sse') &&
      !v.includes('adapters/primary/api/utils') &&
      !v.includes('adapters/secondary/docs/OfficeDocumentReader'),
    );

    if (filtered.length > 0) {
      throw new Error(`Chatbot module isolation violated:\n${filtered.join('\n')}`);
    }
  });

  it('chatbot has its own domain models separate from main domain', () => {
    expect(fs.existsSync(path.join(CHATBOT_SRC, 'domain/models.ts'))).toBe(true);
    expect(fs.existsSync(path.join(CHATBOT_SRC, 'domain/ports.ts'))).toBe(true);
    expect(fs.existsSync(path.join(CHATBOT_SRC, 'domain/host-types.ts'))).toBe(true);
  });

  it('chatbot has its own adapters', () => {
    expect(fs.existsSync(path.join(CHATBOT_SRC, 'adapters/FSConversationStore.ts'))).toBe(true);
    expect(fs.existsSync(path.join(CHATBOT_SRC, 'adapters/FSKnowledgeStore.ts'))).toBe(true);
    expect(fs.existsSync(path.join(CHATBOT_SRC, 'adapters/ChatbotAgentRunner.ts'))).toBe(true);
  });
});
