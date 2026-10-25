# ADR 003: Meeting → Requirements via Zoom MCP and User-Provided AI Keys

## Status

Proposed

## Context

Users want to paste a Zoom meeting link and get a complete, editable list of requirements. Constraints:

- Local, single-user app; no hosted backend.
- Users bring their own AI key and choose the provider (OpenAI, Anthropic or Google).
- Meeting data and requirements must stay on the user's machine and not be committed by accident.

Findings that shaped the design (verified against Zoom's public OAuth metadata in October 2026):

- Zoom's official MCP servers (`https://mcp.zoom.us/mcp/meeting/streamable`, `…/mcp/zoom/streamable`) speak streamable HTTP and require a bearer token.
- Zoom's authorization server advertises **no dynamic client registration** and only `client_secret_basic` at the token endpoint. Every client therefore needs a registered Zoom app (client id + secret). Agent CLIs such as Claude Code avoid this only because their vendor has its own Zoom app.
- Zoom does not publish its MCP tool reference (the documentation pages return 404). Tool names in third-party listings are unverified.

## Decision

1. **The app is the MCP client.** `ZoomMcpMeetingSource` connects with `@modelcontextprotocol/sdk` using the user's token. No agent CLI is involved, so imports work with any LLM provider. Codex's stdio-only MCP support is not a constraint.
2. **Bring-your-own Zoom app.** Each user creates a free "General" user-managed OAuth app. Sign-in uses authorization code + PKCE (`ZoomAuth`). Rotated refresh tokens are persisted, and a single refresh runs at a time. Read-only scopes only. A published app with a token-exchange service can replace this later without changing the domain.
3. **Schema-driven Zoom adapter.** Tools are selected by known names, then by name heuristics. The meeting-id argument is read from each tool's input schema. Results are walked for transcript, summary, topic and date fields, with transcript downloads restricted to `https://*.zoom.us`. Raw tool output is saved to `zoom-raw.json` in the requirement list's folder so real shapes can be inspected.
4. **LLM behind a port.** `LlmPort` has OpenAI, Anthropic and Gemini adapters, each using its provider's official SDK in strict structured-output mode with one shared JSON schema. The model has **no tools**. The transcript is passed as fenced data, and every extracted item starts as `draft`.
5. **The app writes the markdown, the LLM doesn't.** The LLM returns JSON. The app validates it (one retry on invalid output) and serializes `requirements.md`. Parsing is lenient and round-trip safe, so hand edits never break the editor. IDs are stable and never reused.
6. **Local-only data.** Secrets are kept in `~/.speckit-assistant/credentials.json` (0600) and never returned to the browser. Each import is its own requirement list in `.specify/meetings/<date-topic>/`, which is git-ignored on first import.
7. **Local-only server.** `next start` binds to `127.0.0.1`. `middleware.ts` rejects non-loopback `Host` headers (DNS rebinding) and cross-site `Origin`s on state-changing requests (CSRF). This also closes an existing exposure of the agent-run endpoints.
8. **Requirements → features through Spec Kit, not around it.** "Create features" asks the LLM for a grouping (validated: every id used once, open questions attached rather than standalone), the user reviews it, then each group becomes `specs/NNN-name/` via the existing feature creation and the existing Specify phase — the requirements are passed as the phase's prompt context, so Spec Kit's command and templates still write `spec.md`. Requirements record their feature; a copy of each feature's requirements is committed beside its spec; editing a linked requirement refreshes the copy and marks the spec stale (existing staleness mechanism).

## Consequences

- Users must create a Zoom app once (guided in Settings). Uploading a `.vtt`/`.txt` transcript works without Zoom.
- Only meetings in the user's account with cloud-recording transcripts or AI Companion summaries can be fetched. Recording share links are rejected with guidance to upload instead.
- If Zoom changes tool names or shapes, the heuristics degrade to a clear error that lists the available tools. A fix is local to `zoomToolResults.ts`.
- Spec generation runs the user's agent CLI with the repo's existing permission settings (Claude runs with permission prompts bypassed). Requirement text originates in a meeting, so it is fenced as data in the prompt and only reaches the agent after the user has reviewed and accepted it.
- Live (in-meeting) capture is out of scope. It would need Zoom RTMS or local audio capture behind the same `MeetingSourcePort`.
