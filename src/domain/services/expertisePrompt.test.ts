import { describe, it, expect } from 'vitest';
import {
  buildExpertiseProfile,
  resolveExpertiseMode,
  DEFAULT_EXPERTISE_PROFILE,
  UserExpertiseProfile,
} from '../models/types';
import {
  extractionExpertiseAddon,
  specExpertiseAddon,
  clarificationExpertiseAddon,
  planningExpertiseAddon,
  implementationExpertiseAddon,
  withExpertiseAddon,
} from './expertisePrompt';
import { buildExtractionSystemPrompt } from './extractionPrompt';
import { buildSpecPrompt } from './specPrompt';

// ── Model helpers ────────────────────────────────────────────────────────────

describe('resolveExpertiseMode', () => {
  it.each([
    ['technical', 'has-domain', 'power-user'],
    ['technical', 'no-domain', 'domain-transfer'],
    ['non-technical', 'has-domain', 'tech-shield'],
    ['non-technical', 'no-domain', 'full-guidance'],
  ] as const)('%s + %s → %s', (tech, domain, expected) => {
    expect(resolveExpertiseMode(tech, domain)).toBe(expected);
  });
});

describe('buildExpertiseProfile', () => {
  it('computes mode and passes domainContext', () => {
    const p = buildExpertiseProfile('non-technical', 'no-domain', 'healthcare billing');
    expect(p).toEqual({
      technicalLevel: 'non-technical',
      domainKnowledge: 'no-domain',
      domainContext: 'healthcare billing',
      mode: 'full-guidance',
    });
  });

  it('omits domainContext when not provided', () => {
    const p = buildExpertiseProfile('technical', 'has-domain');
    expect(p.domainContext).toBeUndefined();
    expect(p.mode).toBe('power-user');
  });
});

describe('DEFAULT_EXPERTISE_PROFILE', () => {
  it('defaults to power-user', () => {
    expect(DEFAULT_EXPERTISE_PROFILE.mode).toBe('power-user');
  });
});

// ── Addon functions ──────────────────────────────────────────────────────────

const profiles: Record<string, UserExpertiseProfile> = {
  power: buildExpertiseProfile('technical', 'has-domain'),
  domainTransfer: buildExpertiseProfile('technical', 'no-domain'),
  techShield: buildExpertiseProfile('non-technical', 'has-domain'),
  fullGuidance: buildExpertiseProfile('non-technical', 'no-domain'),
};

describe('extractionExpertiseAddon', () => {
  it('returns empty for power-user', () => {
    expect(extractionExpertiseAddon(profiles.power)).toBe('');
  });

  it('returns non-empty for domain-transfer', () => {
    const addon = extractionExpertiseAddon(profiles.domainTransfer);
    expect(addon).toContain('domain-specific term');
    expect(addon).toContain('technical person');
  });

  it('returns non-empty for tech-shield', () => {
    const addon = extractionExpertiseAddon(profiles.techShield);
    expect(addon).toContain('non-technical');
    expect(addon).toContain('plain');
  });

  it('returns non-empty for full-guidance', () => {
    const addon = extractionExpertiseAddon(profiles.fullGuidance);
    expect(addon).toContain('domain-specific term');
    expect(addon).toContain('plain');
  });

  it('defaults to power-user when no profile', () => {
    expect(extractionExpertiseAddon()).toBe('');
    expect(extractionExpertiseAddon(undefined)).toBe('');
  });
});

describe('specExpertiseAddon', () => {
  it('returns empty for power-user', () => {
    expect(specExpertiseAddon(profiles.power)).toBe('');
  });

  it('includes Domain Context for domain-transfer', () => {
    expect(specExpertiseAddon(profiles.domainTransfer)).toContain('Domain Context');
  });

  it('includes user stories for tech-shield', () => {
    expect(specExpertiseAddon(profiles.techShield)).toContain('user stories');
  });

  it('includes both for full-guidance', () => {
    const addon = specExpertiseAddon(profiles.fullGuidance);
    expect(addon).toContain('Domain Context');
    expect(addon).toContain('user stories');
  });
});

describe('clarificationExpertiseAddon', () => {
  it('returns empty for power-user', () => {
    expect(clarificationExpertiseAddon(profiles.power)).toBe('');
  });

  it('focuses on domain meaning for domain-transfer', () => {
    expect(clarificationExpertiseAddon(profiles.domainTransfer)).toContain('domain meaning');
  });

  it('frames in business terms for tech-shield', () => {
    expect(clarificationExpertiseAddon(profiles.techShield)).toContain('business terms');
  });
});

describe('planningExpertiseAddon', () => {
  it('returns empty for power-user', () => {
    expect(planningExpertiseAddon(profiles.power)).toBe('');
  });

  it('writes milestones for tech-shield', () => {
    expect(planningExpertiseAddon(profiles.techShield)).toContain('milestones');
  });
});

describe('implementationExpertiseAddon', () => {
  it('returns empty for power-user', () => {
    expect(implementationExpertiseAddon(profiles.power)).toBe('');
  });

  it('adds domain comments for domain-transfer', () => {
    expect(implementationExpertiseAddon(profiles.domainTransfer)).toContain('business rule');
  });
});

// ── withExpertiseAddon ───────────────────────────────────────────────────────

describe('withExpertiseAddon', () => {
  it('returns base unchanged when addon is empty', () => {
    expect(withExpertiseAddon('base prompt', '')).toBe('base prompt');
  });

  it('appends addon with blank line separator', () => {
    expect(withExpertiseAddon('base', 'addon')).toBe('base\n\naddon');
  });
});

// ── Integration: extraction system prompt ────────────────────────────────────

describe('buildExtractionSystemPrompt', () => {
  it('returns base prompt for power-user profile', () => {
    const prompt = buildExtractionSystemPrompt(profiles.power);
    expect(prompt).toContain('senior business analyst');
    expect(prompt).not.toContain('domain-specific term');
  });

  it('appends domain-transfer addon', () => {
    const prompt = buildExtractionSystemPrompt(profiles.domainTransfer);
    expect(prompt).toContain('senior business analyst');
    expect(prompt).toContain('domain-specific term');
  });

  it('appends full-guidance addon', () => {
    const prompt = buildExtractionSystemPrompt(profiles.fullGuidance);
    expect(prompt).toContain('In simple terms');
  });

  it('returns base when no profile', () => {
    const prompt = buildExtractionSystemPrompt();
    expect(prompt).toContain('senior business analyst');
    expect(prompt).not.toContain('domain-specific term');
  });
});

// ── Integration: spec prompt ─────────────────────────────────────────────────

describe('buildSpecPrompt with expertise', () => {
  const baseOpts = {
    feature: '001-login',
    title: 'User Login',
    meta: { title: 'Login', nextId: 2 },
    requirements: [{
      id: 'REQ-001',
      title: 'Login form',
      type: 'functional' as const,
      priority: 'must' as const,
      status: 'accepted' as const,
      description: 'A login form',
      acceptanceCriteria: ['User can enter email'],
      source: { timestamp: '', speaker: '', quote: '' },
    }],
  };

  it('produces standard spec prompt for power-user', () => {
    const prompt = buildSpecPrompt({ ...baseOpts, expertiseProfile: profiles.power });
    expect(prompt).toContain('User Login');
    expect(prompt).not.toContain('user stories');
  });

  it('adds user stories instruction for tech-shield', () => {
    const prompt = buildSpecPrompt({ ...baseOpts, expertiseProfile: profiles.techShield });
    expect(prompt).toContain('user stories');
  });

  it('adds domain glossary instruction for full-guidance', () => {
    const prompt = buildSpecPrompt({ ...baseOpts, expertiseProfile: profiles.fullGuidance });
    expect(prompt).toContain('Domain Dictionary');
  });
});
