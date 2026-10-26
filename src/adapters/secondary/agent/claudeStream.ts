import { CostMetadata } from "../../../domain/models/types";

// Claude Code in print mode (`-p --output-format stream-json --verbose`) emits
// one JSON event per line and exits when the task is done — unlike interactive
// mode, which waits at its prompt forever and leaves the phase "running". This
// turns that stream into readable log text and the run's real cost.

type Json = Record<string, any>;

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function summarizeToolInput(input: Json | undefined): string {
  if (!input || typeof input !== "object") return "";
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.description ?? input.query;
  return typeof v === "string" ? clip(v.replace(/\s+/g, " ")) : "";
}

export function renderClaudeEvent(ev: Json): string {
  switch (ev?.type) {
    case "system":
      return ev.subtype === "init" ? `▶ Claude${ev.model ? ` (${ev.model})` : ""} started\n` : "";
    case "assistant": {
      let out = "";
      for (const c of ev.message?.content ?? []) {
        if (c?.type === "text" && c.text?.trim()) out += `${c.text.trim()}\n`;
        else if (c?.type === "tool_use") out += `→ ${c.name}${summarizeToolInput(c.input) ? ` ${summarizeToolInput(c.input)}` : ""}\n`;
      }
      return out;
    }
    case "user": {
      let out = "";
      for (const c of ev.message?.content ?? []) {
        if (c?.type === "tool_result" && c.is_error) {
          const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
          out += `  ✗ ${clip(text.split("\n")[0])}\n`;
        }
      }
      return out;
    }
    case "result": {
      const secs = typeof ev.duration_ms === "number" ? `${Math.round(ev.duration_ms / 1000)}s` : "";
      const cost = typeof ev.total_cost_usd === "number" ? ` · $${ev.total_cost_usd.toFixed(3)}` : "";
      const head = ev.is_error || ev.subtype !== "success" ? `✗ Finished with an error (${ev.subtype ?? "error"})` : "✓ Done";
      return `\n${head}${secs ? ` in ${secs}` : ""}${ev.num_turns ? ` · ${ev.num_turns} turns` : ""}${cost}\n`;
    }
    default:
      return "";
  }
}

export function costFromResult(ev: Json): CostMetadata {
  const u = ev.usage ?? {};
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  const model = Object.keys(ev.modelUsage ?? {})[0];
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    ...(typeof ev.total_cost_usd === "number" ? { costUSD: ev.total_cost_usd } : {}),
    ...(model ? { model } : {}),
    ...(typeof ev.duration_ms === "number" ? { durationMs: ev.duration_ms } : {}),
    source: "parsed",
  };
}

// Accepts raw PTY chunks (which may split lines and use \r\n), returns the
// rendered text for every complete line, and remembers the final result event.
export class ClaudeStreamRenderer {
  private buffer = "";
  result?: Json;

  push(chunk: string): string {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.map(l => this.line(l)).join("");
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest ? this.line(rest) : "";
  }

  private line(raw: string): string {
    const text = raw.replace(/\r$/, "").trim();
    if (!text) return "";
    let ev: Json;
    try {
      ev = JSON.parse(text);
    } catch {
      return `${text}\n`; // CLI warnings / errors printed outside the stream
    }
    if (ev?.type === "result") this.result = ev;
    return renderClaudeEvent(ev);
  }
}
