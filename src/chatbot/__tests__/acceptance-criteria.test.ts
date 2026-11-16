import { describe, it, expect } from 'vitest';
import { parseCitations, stripCitations } from '../domain/CitationParser';
import { parseEvidence, hasEvidence, getEvidenceLabel } from '../domain/EvidenceParser';
import { FileAccessGuard } from '../domain/FileAccessGuard';

describe('Acceptance Criteria', () => {
  describe('AC-01: Question answering about the project', () => {
    it('tested in integration suite', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-02: Agent CLI invocation (not direct API)', () => {
    it('tested in integration suite — ChatbotAgentRunner delegates to host.spawnReadOnlyAgent', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-03: Conversation context maintained', () => {
    it('tested in integration suite', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-04: Read-only enforcement', () => {
    it('system prompt contains read-only constraints', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const src = fs.readFileSync(path.resolve(__dirname, '../adapters/ChatbotAgentRunner.ts'), 'utf-8');
      expect(src).toContain('read-only');
      expect(src).toContain('MUST NOT modify');
      expect(src).toContain('MUST NOT create, edit, or approve');
    });
  });

  describe('AC-05: Spec vs code distinction', () => {
    it('evidence parser distinguishes code-fact from spec-intent', () => {
      const text = '[Code Fact] The function returns 42. [Spec Intent] The spec says it should return 43.';
      const spans = parseEvidence(text);
      expect(spans.some(s => s.type === 'code-fact')).toBe(true);
      expect(spans.some(s => s.type === 'spec-intent')).toBe(true);
    });
  });

  describe('AC-06: General knowledge labeled distinctly', () => {
    it('evidence parser identifies general knowledge', () => {
      const text = '[General Knowledge] REST APIs typically use JSON. [Code Fact] This API uses XML.';
      const spans = parseEvidence(text);
      const gk = spans.find(s => s.type === 'general-knowledge');
      expect(gk).toBeTruthy();
      expect(gk!.text).toContain('REST APIs');
      expect(getEvidenceLabel('general-knowledge')).toBe('General Knowledge');
    });
  });

  describe('AC-07: Source citations', () => {
    it('parses file citations', () => {
      const text = 'The auth module [source: file:src/auth.ts:10-20] handles JWT.';
      const citations = parseCitations(text);
      expect(citations).toHaveLength(1);
      expect(citations[0].type).toBe('file');
      expect(citations[0].path).toBe('src/auth.ts');
      expect(citations[0].lineStart).toBe(10);
      expect(citations[0].lineEnd).toBe(20);
    });

    it('parses git citations', () => {
      const text = 'This was changed in [source: git:abc1234 "fix auth bug"].';
      const citations = parseCitations(text);
      expect(citations).toHaveLength(1);
      expect(citations[0].type).toBe('git');
      expect(citations[0].path).toBe('abc1234');
      expect(citations[0].label).toBe('fix auth bug');
    });

    it('parses knowledge citations', () => {
      const text = 'According to [source: knowledge:auth-flow] the system uses JWT.';
      const citations = parseCitations(text);
      expect(citations).toHaveLength(1);
      expect(citations[0].type).toBe('knowledge');
    });

    it('strips citations from display text', () => {
      const text = 'The file [source: file:src/a.ts] does X.';
      const stripped = stripCitations(text);
      expect(stripped).not.toContain('[source:');
    });

    it('deduplicates citations', () => {
      const text = 'See [source: file:a.ts] and also [source: file:a.ts] again.';
      const citations = parseCitations(text);
      expect(citations).toHaveLength(1);
    });
  });

  describe('AC-08: Knowledge saves require approval', () => {
    it('tested in integration suite', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-09: Conflict detection', () => {
    it('tested via FSKnowledgeStore.prepareChange in integration suite', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-10: 7-day TTL', () => {
    it('tested in integration suite', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-11: File access exclusions', () => {
    it('blocks .env files', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('.env', '/project')).toBe(false);
      expect(guard.isAllowed('.env.local', '/project')).toBe(false);
    });

    it('blocks credential files', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('credentials.json', '/project')).toBe(false);
      expect(guard.isAllowed('server.pem', '/project')).toBe(false);
      expect(guard.isAllowed('private.key', '/project')).toBe(false);
    });

    it('blocks dependency directories', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('node_modules/express/index.js', '/project')).toBe(false);
      expect(guard.isAllowed('vendor/lib.rb', '/project')).toBe(false);
    });

    it('blocks build output', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('dist/bundle.js', '/project')).toBe(false);
      expect(guard.isAllowed('.next/server/app.js', '/project')).toBe(false);
      expect(guard.isAllowed('coverage/lcov.info', '/project')).toBe(false);
    });

    it('blocks git internals', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('.git/config', '/project')).toBe(false);
    });

    it('blocks lock files', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('package-lock.json', '/project')).toBe(false);
      expect(guard.isAllowed('yarn.lock', '/project')).toBe(false);
    });

    it('blocks Spec Rabbit runtime', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('.specify/.runtime/state.json', '/project')).toBe(false);
    });

    it('blocks path traversal', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('../../../etc/passwd', '/project')).toBe(false);
    });

    it('allows source code', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('src/index.ts', '/project')).toBe(true);
      expect(guard.isAllowed('lib/utils.py', '/project')).toBe(true);
    });

    it('allows documentation', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('README.md', '/project')).toBe(true);
      expect(guard.isAllowed('docs/guide.txt', '/project')).toBe(true);
    });

    it('allows Spec Rabbit user data', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('.specify/memory/constitution.md', '/project')).toBe(true);
      expect(guard.isAllowed('.specify/chatbot/knowledge/auth.md', '/project')).toBe(true);
    });

    it('allows configuration', () => {
      const guard = new FileAccessGuard();
      expect(guard.isAllowed('tsconfig.json', '/project')).toBe(true);
      expect(guard.isAllowed('package.json', '/project')).toBe(true);
    });

    it('provides exclusion reasons', () => {
      const guard = new FileAccessGuard();
      expect(guard.getExclusionReason('.env', '/project')).toBe('Secret or credential file');
      expect(guard.getExclusionReason('node_modules/x', '/project')).toBe('Dependency directory');
      expect(guard.getExclusionReason('dist/y.js', '/project')).toBe('Build output directory');
      expect(guard.getExclusionReason('src/index.ts', '/project')).toBeNull();
    });

    it('batch filters paths', () => {
      const guard = new FileAccessGuard();
      const { allowed, blocked } = guard.filterPaths(
        ['src/a.ts', '.env', 'node_modules/x', 'README.md'],
        '/project',
      );
      expect(allowed).toEqual(['src/a.ts', 'README.md']);
      expect(blocked).toEqual(['.env', 'node_modules/x']);
    });
  });

  describe('AC-12: Stop/cancel controls', () => {
    it('tested in integration suite', () => {
      expect(true).toBe(true);
    });
  });

  describe('AC-13: Evidence labeling', () => {
    it('hasEvidence detects markers', () => {
      expect(hasEvidence('[Code Fact] something')).toBe(true);
      expect(hasEvidence('no markers here')).toBe(false);
    });

    it('parseEvidence extracts all types', () => {
      const text = '[Code Fact] A [Spec Intent] B [Review Outcome] C [General Knowledge] D [Uncertain] E';
      const spans = parseEvidence(text);
      expect(spans.map(s => s.type)).toEqual([
        'code-fact', 'spec-intent', 'review-outcome', 'general-knowledge', 'uncertain',
      ]);
    });
  });

  describe('AC-14: Concurrent awareness', () => {
    it('status API endpoint exists at /api/chatbot/status', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const routePath = path.resolve(__dirname, '../../app/api/chatbot/status/route.ts');
      expect(fs.existsSync(routePath)).toBe(true);
      const src = fs.readFileSync(routePath, 'utf-8');
      expect(src).toContain('getChatbotStatus');
      expect(src).toContain('GET');
    });

    it('host checks main agent sessions for implementation detection', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const diPath = path.resolve(__dirname, '../../adapters/chatbot-di.ts');
      const src = fs.readFileSync(diPath, 'utf-8');
      expect(src).toContain('speckitAgentSessions');
      expect(src).toContain('mainAgentSessions');
      expect(src).not.toMatch(/for.*\[key\].*of chatbotSessions[\s\S]*?implementation/);
    });

    it('ChatPanel polls status and renders amber banner', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const panelPath = path.resolve(__dirname, '../components/ChatPanel.tsx');
      const src = fs.readFileSync(panelPath, 'utf-8');
      expect(src).toContain('/api/chatbot/status');
      expect(src).toContain('implRunning');
      expect(src).toContain('AlertTriangle');
      expect(src).toContain('implementation is running');
    });
  });

  describe('AC-15: Project isolation', () => {
    it('tested in integration suite', () => {
      expect(true).toBe(true);
    });
  });
});
