import { describe, it, expect } from 'vitest';
import { parseMeetingInput } from './zoomLink';

describe('parseMeetingInput', () => {
  it.each([
    ['https://us02web.zoom.us/j/85012345678?pwd=abc', '85012345678'],
    ['https://zoom.us/j/850123456', '850123456'],
    ['zoom.us/j/85012345678', '85012345678'],
    ['https://company.zoom.us/w/85012345678?tk=x', '85012345678'],
    ['https://zoom.us/s/85012345678', '85012345678'],
    ['https://app.zoom.us/wc/join/85012345678', '85012345678'],
    ['https://zoom.us/wc/85012345678/join', '85012345678'],
    ['https://agency.zoomgov.com/j/1612345678', '1612345678'],
    ['850 1234 5678', '85012345678'],
    ['850-1234-5678', '85012345678'],
  ])('%s → %s', (input, id) => {
    expect(parseMeetingInput(input)).toEqual({ kind: 'meeting', meetingId: id });
  });

  it('flags recording share links and personal rooms as unsupported', () => {
    expect(parseMeetingInput('https://us02web.zoom.us/rec/share/AbCdEf.123')).toMatchObject({ kind: 'unsupported', reason: 'recording-share' });
    expect(parseMeetingInput('https://zoom.us/rec/play/xyz')).toMatchObject({ kind: 'unsupported', reason: 'recording-share' });
    expect(parseMeetingInput('https://zoom.us/my/jane.doe')).toMatchObject({ kind: 'unsupported', reason: 'personal-room' });
  });

  it.each([
    '',
    '   ',
    'https://evil.example.com/j/85012345678',
    'https://zoom.us.evil.com/j/85012345678',
    'https://zoom.us/j/123',
    'https://zoom.us/profile',
    'not a link at all',
    '12345',
  ])('rejects %j', input => {
    expect(parseMeetingInput(input).kind).toBe('invalid');
  });
});
