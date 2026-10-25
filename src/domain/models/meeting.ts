// A meeting's content as fetched from a source (Zoom MCP or an uploaded file),
// normalized to plain text before it is handed to the LLM.
export type MeetingSnapshot = {
  source: 'zoom' | 'upload';
  meetingId?: string;
  topic?: string;
  startTime?: string;
  transcript: string; // "[00:12:41] Sarah: …" lines, or raw text for uploads
  summary?: string;   // AI Companion summary / notes, when available
};

export type MeetingInput =
  | { kind: 'meeting'; meetingId: string }
  | { kind: 'unsupported'; reason: 'recording-share' | 'personal-room'; message: string }
  | { kind: 'invalid'; message: string };

// Outcome codes the import pipeline reports to the UI. Anything other than
// 'ok' carries a user-facing message.
export type ImportStatus =
  | 'ok'
  | 'invalid_input'
  | 'unsupported_link'
  | 'not_configured'  // missing LLM key or Zoom credentials
  | 'auth_required'   // Zoom not connected / token revoked
  | 'not_found'
  | 'no_transcript'
  | 'source_error'    // Zoom MCP server failed or offered no usable tool
  | 'llm_error'
  | 'invalid_output';

export type ImportProgress = {
  step: 'resolving' | 'fetching' | 'extracting' | 'saving';
  message: string;
};
