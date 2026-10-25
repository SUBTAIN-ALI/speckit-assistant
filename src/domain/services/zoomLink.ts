import { MeetingInput } from '../models/meeting';

// Turns what a user pastes (a Zoom join link or a bare meeting ID) into a meeting
// ID. Recording share links and personal-room links don't identify a specific
// meeting, so they are reported as unsupported with an actionable message.

const ZOOM_HOST_RE = /(^|\.)zoom\.us$|(^|\.)zoomgov\.com$/i;
const MEETING_PATH_RES = [
  /^\/(?:j|w|s|wc\/join)\/(\d{9,12})(?:\/|$)/,
  /^\/wc\/(\d{9,12})\/(?:join|start)(?:\/|$)/,
];

export function parseMeetingInput(raw: string): MeetingInput {
  const input = (raw ?? '').trim();
  if (!input) return { kind: 'invalid', message: 'Paste a Zoom meeting link or meeting ID.' };

  const digits = input.replace(/[\s-]/g, '');
  if (/^\d{9,12}$/.test(digits)) return { kind: 'meeting', meetingId: digits };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { kind: 'invalid', message: 'That is not a Zoom link or meeting ID.' };
  }
  if (!ZOOM_HOST_RE.test(url.hostname)) {
    return { kind: 'invalid', message: 'That is not a Zoom link or meeting ID.' };
  }

  const p = url.pathname;
  if (/^\/rec\/(share|play)\//.test(p)) {
    return {
      kind: 'unsupported',
      reason: 'recording-share',
      message: 'Recording share links can’t be looked up through Zoom. Paste the meeting’s join link or ID if you hosted it, or upload the transcript file instead.',
    };
  }
  if (/^\/my\//.test(p)) {
    return {
      kind: 'unsupported',
      reason: 'personal-room',
      message: 'Personal room links are reused for many meetings. Paste the meeting ID of the specific session, or upload its transcript.',
    };
  }
  for (const re of MEETING_PATH_RES) {
    const m = re.exec(p);
    if (m) return { kind: 'meeting', meetingId: m[1] };
  }
  return { kind: 'invalid', message: 'Couldn’t find a meeting ID in that Zoom link.' };
}
