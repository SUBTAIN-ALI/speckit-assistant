import { CitationSource } from './models';

const CITATION_REGEX = /\[source:\s*(file|spec|git|knowledge|meeting|review):([^\]]+)\]/g;

function parseLineRange(rangeStr: string): { lineStart?: number; lineEnd?: number } {
  const match = rangeStr.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return {};
  return {
    lineStart: parseInt(match[1], 10),
    lineEnd: match[2] ? parseInt(match[2], 10) : undefined,
  };
}

export function parseCitations(text: string): CitationSource[] {
  const citations: CitationSource[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = CITATION_REGEX.exec(text)) !== null) {
    const type = match[1] as CitationSource['type'];
    const rawValue = match[2].trim();
    const dedupKey = `${type}:${rawValue}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    switch (type) {
      case 'file': {
        const parts = rawValue.split(':');
        const filePath = parts[0];
        const range = parts[1] ? parseLineRange(parts[1]) : {};
        citations.push({ type, path: filePath, ...range });
        break;
      }
      case 'git': {
        const gitMatch = rawValue.match(/^([a-f0-9]+)\s*(?:"([^"]*)")?/);
        if (gitMatch) {
          citations.push({
            type,
            path: gitMatch[1],
            label: gitMatch[2] || undefined,
          });
        }
        break;
      }
      case 'spec':
      case 'knowledge':
      case 'meeting':
      case 'review':
        citations.push({ type, path: rawValue });
        break;
    }
  }

  return citations;
}

export function stripCitations(text: string): string {
  return text.replace(CITATION_REGEX, '').replace(/  +/g, ' ');
}

export function extractUniqueSources(messages: { content: string }[]): CitationSource[] {
  const all: CitationSource[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    for (const c of parseCitations(msg.content)) {
      const key = `${c.type}:${c.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(c);
      }
    }
  }
  return all;
}
