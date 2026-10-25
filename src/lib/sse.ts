// Reads a text/event-stream response body, calling onEvent for each
// `event: <name>` / `data: <json>` message until the stream ends.
export async function readSse(res: Response, onEvent: (name: string, data: any) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      const name = /^event: (.*)$/m.exec(evt)?.[1];
      const dataLine = /^data: (.*)$/m.exec(evt)?.[1];
      if (!name || !dataLine) continue;
      try {
        onEvent(name, JSON.parse(dataLine));
      } catch {
        // ignore a malformed message
      }
    }
  }
}
