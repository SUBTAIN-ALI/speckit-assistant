# Ticket 14: Evidence Distinction Labels

**Priority:** P1  
**Depends On:** Ticket 13  
**Requirements Ref:** Sections 6.1, 6.2, 6.4, AC-05, AC-06  
**Estimated Effort:** Small  

## Description

The chatbot must clearly distinguish between different types of evidence in its answers:

| Label | Meaning | Example |
|---|---|---|
| **Code Fact** | Verified by inspecting current source code | "The auth middleware checks JWT expiry at line 42" |
| **Spec Intent** | Documented in a specification or requirement | "The spec says refunds should complete within 14 days" |
| **Review Outcome** | Found in a test/review report | "The QA review flagged this as a race condition" |
| **General Knowledge** | Industry convention, not project-specific | "JWT tokens typically expire after 1 hour" |
| **Uncertain** | Evidence is incomplete | "The project files don't establish why this design was chosen" |

The agent is already prompted to make these distinctions (Ticket 04). This ticket:
1. Parses evidence labels from the agent's response
2. Renders them visually in the UI
3. Ensures the illustrative format from Requirements Section 6.4 is achievable

## Implementation

### Agent Prompt Enhancement (in Ticket 04's `READ_ONLY_SYSTEM_PROMPT`)

Add structured output format:

```
When answering, structure your response with evidence labels:

**[Code Fact]** The inventory workflow in src/orders/reserve.ts reserves stock when an order is initiated.

**[General Knowledge]** Inventory reservation is commonly used to reduce overselling during checkout.

**[Uncertain]** The available project records do not establish why this particular team chose that policy.
```

### Parser: `src/chatbot/domain/EvidenceParser.ts`

```typescript
import { EvidenceLabel } from './models';

export function extractEvidenceLabels(text: string): EvidenceLabel[] {
  const labelRegex = /\*\*\[(Code Fact|Spec Intent|Review Outcome|General Knowledge|Uncertain)\]\*\*\s*([^\n]+(?:\n(?!\*\*\[).*)*)/g;
  const labels: EvidenceLabel[] = [];
  let match;
  while ((match = labelRegex.exec(text)) !== null) {
    labels.push({
      type: mapLabelType(match[1]),
      text: match[2].trim(),
    });
  }
  return labels;
}
```

### UI Rendering

Each evidence-labeled section gets a visual indicator:
- **Code Fact**: Blue left border + code icon
- **Spec Intent**: Purple left border + document icon
- **Review Outcome**: Orange left border + check icon
- **General Knowledge**: Gray left border + globe icon + "General Knowledge" badge
- **Uncertain**: Yellow left border + warning icon

These indicators appear inline within the assistant message, not as separate blocks.

## Acceptance Criteria

- [ ] Agent responses include evidence labels when evidence is available
- [ ] `EvidenceParser` extracts typed evidence labels from response text
- [ ] Labels stored in `ChatMessage.evidenceLabels[]`
- [ ] Each label type rendered with distinct visual indicator
- [ ] General Knowledge always visually distinguished from project facts (AC-06)
- [ ] SDD records (specs, tickets, reviews) distinguishable from code (AC-05)
- [ ] Uncertain evidence clearly marked

## Test Cases

### `src/chatbot/domain/__tests__/EvidenceParser.test.ts`

```typescript
import { extractEvidenceLabels } from '../EvidenceParser';

describe('EvidenceParser', () => {
  // T14-1: Extract Code Fact
  it('extracts Code Fact label', () => {
    const text = '**[Code Fact]** The auth module validates JWT tokens at startup.';
    const labels = extractEvidenceLabels(text);
    expect(labels).toHaveLength(1);
    expect(labels[0].type).toBe('code-fact');
    expect(labels[0].text).toContain('JWT tokens');
  });

  // T14-2: Extract General Knowledge
  it('extracts General Knowledge label', () => {
    const text = '**[General Knowledge]** JWT is a common stateless auth mechanism.';
    const labels = extractEvidenceLabels(text);
    expect(labels[0].type).toBe('general-knowledge');
  });

  // T14-3: Extract Uncertain
  it('extracts Uncertain label', () => {
    const text = '**[Uncertain]** No documentation explains why this approach was chosen.';
    const labels = extractEvidenceLabels(text);
    expect(labels[0].type).toBe('uncertain');
  });

  // T14-4: Multiple labels in one response
  it('extracts multiple evidence types', () => {
    const text = [
      '**[Code Fact]** Stock is reserved in reserve.ts.',
      '**[General Knowledge]** Reservation prevents overselling.',
      '**[Uncertain]** The reason for this specific policy is undocumented.',
    ].join('\n\n');
    const labels = extractEvidenceLabels(text);
    expect(labels).toHaveLength(3);
    expect(labels.map(l => l.type)).toEqual(['code-fact', 'general-knowledge', 'uncertain']);
  });

  // T14-5: Spec Intent
  it('extracts Spec Intent label', () => {
    const text = '**[Spec Intent]** The specification requires refunds within 14 days.';
    const labels = extractEvidenceLabels(text);
    expect(labels[0].type).toBe('spec-intent');
  });

  // T14-6: Review Outcome
  it('extracts Review Outcome label', () => {
    const text = '**[Review Outcome]** QA flagged this as a potential race condition.';
    const labels = extractEvidenceLabels(text);
    expect(labels[0].type).toBe('review-outcome');
  });

  // T14-7: No labels returns empty array
  it('returns empty array for plain text', () => {
    const labels = extractEvidenceLabels('Just a normal answer.');
    expect(labels).toEqual([]);
  });

  // T14-8: Multi-line labeled section
  it('captures multi-line evidence text', () => {
    const text = '**[Code Fact]** The auth module:\n- Validates JWT\n- Checks expiry\n- Refreshes token';
    const labels = extractEvidenceLabels(text);
    expect(labels[0].text).toContain('Validates JWT');
    expect(labels[0].text).toContain('Refreshes token');
  });
});
```
