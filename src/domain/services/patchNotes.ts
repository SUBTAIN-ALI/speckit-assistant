// Append-only patch notes for a feature. Each fix applied after a review gate
// failure gets a numbered entry in specs/<feature>/patch-notes.md, giving
// personas and the implementation agent an amended contract to validate against.

import { PersonaId } from '../models/types';

export type PatchNoteEntry = {
  personaId: PersonaId;
  personaLabel: string;
  fixInstruction: string;
  timestamp: string;
};

const HEADER = `# Patch Notes

Fix instructions applied after review gate failures. The implementation agent
applied each fix, and review personas should validate against these amendments.

`;

export function patchNotesPath(featureName: string): string {
  return `specs/${featureName}/patch-notes.md`;
}

export async function appendPatchNote(
  readFile: (path: string) => Promise<string>,
  writeFile: (path: string, content: string) => Promise<void>,
  featureName: string,
  entry: PatchNoteEntry
): Promise<void> {
  const path = patchNotesPath(featureName);

  let existing = '';
  try {
    existing = await readFile(path);
  } catch {
    // File doesn't exist yet
  }

  if (!existing) {
    existing = HEADER;
  }

  // Count existing fix entries to number this one
  const fixCount = (existing.match(/^## Fix #\d+/gm) ?? []).length;
  const fixNumber = fixCount + 1;

  const section = `## Fix #${fixNumber} — ${entry.personaLabel} (${entry.timestamp})\n\n${entry.fixInstruction}\n\n---\n\n`;

  await writeFile(path, existing + section);
}
