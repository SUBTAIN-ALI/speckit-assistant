import { describe, it, expect } from 'vitest';
import { sseResponse } from './sse';

describe('sseResponse', () => {
  it('streams events and closes', async () => {
    const res = sseResponse(async send => { send('a', { x: 1 }); send('b', 2); });
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toBe('event: a\ndata: {"x":1}\n\nevent: b\ndata: 2\n\n');
  });

  it('keeps the job running after the client disconnects', async () => {
    let finished = false;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const res = sseResponse(async send => {
      send('start', 1);
      await gate;            // the client disconnects while the job is busy
      send('progress', 2);   // must not throw
      send('done', 3);
      finished = true;
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    release();
    await new Promise(r => setTimeout(r, 10));
    expect(finished).toBe(true);
  });

  it('reports a thrown error as an error event', async () => {
    const res = sseResponse(async () => { throw new Error('boom'); });
    expect(await res.text()).toContain('event: error\ndata: {"message":"boom"}');
  });
});
