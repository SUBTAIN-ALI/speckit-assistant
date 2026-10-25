import { NextResponse } from 'next/server';
import { zoomMeetingSource } from '../../../../../adapters/di';
import { MeetingSourceError } from '../../../../../domain/ports/out/MeetingSourcePort';

export const dynamic = 'force-dynamic';

// "Test connection": signs in to Zoom's MCP server and lists its tools.
export async function GET() {
  try {
    const tools = await zoomMeetingSource.listTools();
    return NextResponse.json({ tools: tools.map(t => ({ name: t.name, description: t.description })) });
  } catch (err: any) {
    const status = err instanceof MeetingSourceError && err.code === 'auth_required' ? 401 : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
}
