import { MeetingSnapshot } from '../../models/meeting';

export class MeetingSourceError extends Error {
  constructor(public code: 'auth_required' | 'not_found' | 'no_transcript' | 'unavailable', message: string) {
    super(message);
  }
}

export type MeetingFetchResult = {
  snapshot: MeetingSnapshot;
  // Raw tool calls/results, saved next to the meeting for troubleshooting.
  raw?: unknown;
};

export interface MeetingSourcePort {
  fetchMeeting(meetingId: string, onProgress?: (message: string) => void): Promise<MeetingFetchResult>;
}

export type ZoomToolInfo = { name: string; description?: string; inputSchema?: unknown };

// Lists what the connected Zoom MCP server offers (used by the settings screen
// to confirm the connection and show the real tool names).
export interface ZoomToolDiscoveryPort {
  listTools(): Promise<ZoomToolInfo[]>;
}
