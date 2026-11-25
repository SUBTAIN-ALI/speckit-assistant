# EPS requirements integration

Open **Requirements → EPS** in the project workspace that contains the code to change.

1. Select staging, enter an EPS machine token, and save the connection. A master EPS admin generates this token in **MCP Tokens → Generate**. Use a staging token for staging.
2. Test the saved connection, then browse released requirements. Import only the requirements intended for this project. The EPS API does not provide a documented repository mapping.
3. Open an imported requirement list and use the existing **Create features** flow. EPS supplies structured business outcomes and acceptance criteria; importing does not require an AI provider key. Feature generation still needs the existing Spec Kit and agent setup.
4. Review specifications and plans through the existing workflow. Enable synchronization to report progress every two minutes while the local app server is running, or use **Sync now**.

The backend integration works with all existing agent types. It does not depend on their native MCP configuration exporters. Existing Zoom, document imports, agent settings, reviews, and approvals retain their existing behavior.

## Progress and delivery

Each EPS UUID is mapped to a local `REQ-...` and its feature. A provenance reference is also included in the requirement's source and copied into feature requirements. Automatic reports include phase statuses, stale markers, review report paths, and task completion counts in the SDLC manifest. Existing remote manifest fields are retained when preparing updates, subject to EPS's documented last-write-wins behavior.

Before implementation the reported stage is at least `plan_review`; implementation activity advances to `ai_dev`; an approved implementation without stale phases or failed reviews advances to `uat`. Automatic reports never promote a requirement to `prod` or infer regulatory compliance. A remote stage is not automatically moved backward; stale/failed work is recorded in the manifest.

Use **Report delivery or compliance evidence** for verified production delivery, PR/release/test links, and individual compliance flags. Evidence is required. Unknown flags remain unchanged. The person submitting evidence is responsible for verifying it.

## Owner conversation

Send an update or question in the linked requirement's EPS panel. A question notifies the owner through EPS and pauses new runs of the linked feature, including Quick Build, fixes, reviews, and feature-scoped DevOps. Finish or stop an active feature run before sending a blocking question.

Synchronize to retrieve answers. **Apply answer to requirement** appends the selected business answer, updates the linked feature requirements, marks affected specifications stale, and clears the question pause. Applying the same answer repeatedly does not duplicate it. Review the updated specification/plan through the existing approval flow before proceeding.

## Reliability and recovery

- Background polling runs on the backend, independent of browser tabs. It follows the currently selected workspace; switching projects changes the polling target. Restarting the app resumes enabled synchronization for the selected workspace.
- Imports use deterministic paths so interrupted imports can be resumed without creating duplicate lists.
- State, conversation cursors, and pending writes survive restarts. Writes use atomic file replacement and synchronization takes a per-workspace file lock across server processes.
- Repeatable reports retry with backoff. Messages whose delivery is uncertain are **never automatically resent**. Check the EPS conversation, discard the queued item, and compose a new message only if necessary. Discarding an unsent/uncertain blocking question also clears its local pause.
- HTTP 401 pauses synchronization until a replacement token is saved. No automatic refresh or same-token retry is attempted.
- Polling overlaps the latest message timestamp by one second and deduplicates message IDs.
- Remote business edits refresh clean local requirements and mark linked specifications stale. Conflicting local edits are preserved and surfaced for explicit replacement. Replacing local content also removes locally applied clarifications.
- Requirements missing from the released list are retained locally, but new work and reports are paused until they become available again.

## Storage and configuration

EPS credentials and per-workspace state are separate from existing Zoom/LLM settings. Files are stored under `~/.speckit-assistant/eps/` with mode `0600`; the directory is created with mode `0700`. Token values are not returned to the browser or stored in the project. The initial token-entry form sends the value only to the local backend.

Alternatively, provide `EPS_MCP_STAGING_TOKEN` or `EPS_MCP_PRODUCTION_TOKEN` in the app server environment. `EPS_MCP_TOKEN` is a fallback for the selected environment. Saved tokens take precedence. Rotate a rejected token using the EPS panel to clear the authentication pause.

Local requirement sets remain under `.specify/meetings/eps-<environment>-<uuid>/requirements.md`, compatible with the current Requirements UI. Imported requirements are initially accepted because the owner has released them; development artifact approvals remain separate.

Use a separate workspace for a different EPS environment after importing requirements. A workspace is pinned to its environment to prevent reporting staging work to production IDs.

## Validation boundaries

Automated tests cover a stateless JSON MCP server using the documented protocol version, SDK negotiation without an SSE stream/session, imports, mapping, conflicts, messages, retries, token rejection, private storage, UI actions, and workflow pause guards. Live staging validation requires a real EPS token and an owner-approved released test requirement. No production request is needed to verify the local implementation.
