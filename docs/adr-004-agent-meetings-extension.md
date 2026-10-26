# ADR 004: Agent-Driven Meetings Extension

## Status

Proposed. Amends [ADR 003](adr-003-meeting-requirements.md).

## Context

ADR 003 introduced meeting → requirements → features, with the app calling an LLM provider directly (the user's API key) and acting as its own Zoom MCP client. That works, but it diverges from three conventions the rest of speckit-assistant follows:

1. **The active agent drives every workflow run.** Phases, review personas and DevOps agents are all executed by the agent CLI selected in Agents. ADR 003 added a second AI path.
2. **Capabilities ship as Spec Kit extensions** (`spec-kit-personas`, `spec-kit-spec-agents`, `spec-kit-devops`) that are installed from the Extensions panel and expose namespaced slash commands.
3. **MCP servers are defined once in MCP Tools** and applied to agents. The Zoom server was hardcoded in the app instead.

## Decision

1. **Bundled extension `spec-kit-meetings`** (`extensions/spec-kit-meetings/`), modeled on `spec-kit-devops` (on-demand commands, no hooks):
   - `/speckit.meetings.import <list-dir> [meeting-id]` reads the meeting (Zoom MCP tools, or the `transcript.md` the app wrote). It writes `transcript.md` / `summary.md`, then `extraction.json` in the ADR 003 schema, plus `status.json` (`ok`, `not_found`, `no_transcript` or `auth_required`, with the topic and date).
   - `/speckit.meetings.group <list-dir>` reads `grouping-request.json` and `requirements.md`, then writes `grouping.json`.
   - As with persona reports, **the agent writes files and the app validates them**, using the existing validators and one retry with the error as context. Parsing, storage, linking and stale marking are unchanged.
2. **`AgentRunnerPort.runCommand`**: a general on-demand command runner, the same mechanism as `runDevOps`. For Claude it supports a **least-privilege unattended mode**: `-p`, `--permission-mode dontAsk`, `--strict-mcp-config` with only the given servers, and `--allowedTools Read Glob Grep Edit(<list-dir>/**) mcp__<zoom>`. A live check confirmed that writes outside the folder and shell commands are refused, with no prompt and no hang. Workflow phases keep the repo's existing invocation.
3. **Zoom through MCP Tools.** `McpServer.headers` (translated for Claude and Gemini), an **Add Zoom** preset identical to Zoom's official plugin (`Authorization: Bearer ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN}`), and an `AgentEnvProvider` on the runner that injects a fresh token from the existing Zoom sign-in into every agent run. Any phase can therefore use Zoom once it is assigned to the agent.
4. **Requirements engine setting:** `agent` (default) or `direct` (the ADR 003 path, kept as the faster option). If unset and an API key is already configured, the engine stays `direct` so existing setups keep working before the extension is installed.
5. **CLI parity:** `import`, `requirements` and `create-features` subcommands use the same services.

## Consequences

- No API key is needed by default. AI usage is billed to, and governed by, the user's agent, the same as the rest of the workflow.
- Agent runs are slower than direct calls (about 60 s to import and 25 s to group in a live run with Claude), so direct mode remains available.
- Least-privilege enforcement is implemented for Claude. Other agents run with their normal invocation; their own sandboxing applies.
- The app's own Zoom client (`ZoomMcpMeetingSource`) remains for direct mode and for *Test connection*. Agent mode reads Zoom only through MCP Tools.
- Requires Spec Kit in the workspace (for the extension) and, for Zoom links, the Zoom MCP server assigned to the active agent. The Requirements section checks both and links to the fixing section.
