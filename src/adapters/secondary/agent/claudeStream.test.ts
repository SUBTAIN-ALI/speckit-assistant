import { describe, it, expect } from 'vitest';
import { ClaudeStreamRenderer, renderClaudeEvent } from './claudeStream';

describe('claudeStream', () => {
  it('renders tool errors and error results, ignores noise', () => {
    expect(renderClaudeEvent({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'Permission denied\nmore' }] } })).toBe('  ✗ Permission denied\n');
    expect(renderClaudeEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } })).toBe('');
    expect(renderClaudeEvent({ type: 'rate_limit_event' })).toBe('');
    expect(renderClaudeEvent({ type: 'result', subtype: 'error_max_turns', is_error: true })).toContain('✗ Finished with an error (error_max_turns)');
  });
  it('passes through non-JSON lines (CLI warnings) and flushes a trailing partial line', () => {
    const r = new ClaudeStreamRenderer();
    expect(r.push('Warning: something\r\n{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}')).toBe('Warning: something\n');
    expect(r.flush()).toBe('hi\n');
  });
});
