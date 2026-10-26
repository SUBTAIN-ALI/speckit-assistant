// A text/event-stream response whose producer keeps running after the client
// disconnects (closing a dialog, navigating away): sends to a closed stream are
// dropped instead of throwing, so long jobs — agent runs creating features —
// are never abandoned halfway.
export type SseSend = (event: string, data: unknown) => void;

export function sseResponse(run: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      const send: SseSend = (event, data) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // client went away; keep working, stop sending
        }
      };
      try {
        await run(send);
      } catch (err: any) {
        send('error', { message: err?.message ?? String(err) });
      }
      if (open) {
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
