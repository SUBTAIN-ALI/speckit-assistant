# 01 | Product overview and reading guide

Spec Rabbit is a local web application that coordinates spec-driven software development. Its package and command-line name is `speckit-assistant`. It connects requirements, project rules, feature specifications, plans, task checklists, coding agents, reviews, and operational actions in one interface.

The app runs on a developer's machine and works against a selected project folder, called a workspace. The browser is the control surface. The Next.js server reads and writes project files, runs agent command-line programs, manages integrations, and streams progress back to the browser. The workspace's Markdown files are the main record of the project.

## Document scope

This guide describes the source in this working directory on 13 November 2026. The package declares version **0.4.0**; the inspected Git base is **90335d9**, with local changes present. Those local changes include browser tests, project chat, expertise guidance, and workflow improvements. This guide therefore describes the current source snapshot, rather than promising that every feature exists in a published npm release.

The audience includes product owners, developers, reviewers, testers, and operators. Chapters 2–10 explain daily use; chapters 11–15 explain supporting systems; chapters 16–18 provide scenarios, troubleshooting, and technical references.

This is a source-based functional guide. External providers, agent CLIs, OAuth services, deployment targets, and browser extensions were not exercised for this documentation task. Example requirements and feature names are illustrative. Existing README screenshots predate some current features and are not used as evidence of the latest interface.

## The main responsibilities

| Participant | Responsibility |
| --- | --- |
| Human user | Select the workspace, review requirements, direct runs, inspect output, and approve work. |
| Spec Rabbit | Coordinate work, expose files and statuses, launch processes, retain logs, and present results. |
| Spec Kit | Provide the specification workflow commands, templates, scripts, and extension mechanism. |
| Active coding agent | Interpret prompts, run Spec Kit commands, update documents, implement code, and produce reports. |
| AI API provider | Extract or group requirements in Direct mode, transcribe recordings where configured, and answer project chat. |
| MCP server | Give an agent or integration access to external tools, such as Zoom meeting assets. |

## What completion means

A completed feature has moved through the workflow's approved or skipped phases. That status is a recorded decision. It should be supported by inspected code, task progress, relevant tests, and review evidence. The application also exposes direct approvals and drag actions, so a completed card alone is not proof that software is correct or deployed.

# 02 | Complete lifecycle at a glance

The normal journey begins with a project folder and ends with a reviewed implementation. Deployment and monitoring are subsequent, explicitly launched operations. Requirements can enter through meetings, recordings, documents, transcripts, or manual entry; a user can also create a feature directly.

::: lifecycle

## The end-to-end sequence

1. **Open a workspace.** Start the local server and select the project that contains, or will contain, your application.
2. **Prepare the tools.** Configure an active coding agent, initialize Spec Kit, and install the required extensions. Configure API keys and Zoom only for the paths that need them.
3. **Capture intent.** Import a source or write a requirement set manually. Check the generated requirements and their acceptance criteria.
4. **Choose scope.** Accept or reject requirements, select the intended set, and review the proposed feature grouping.
5. **Generate a specification.** Create numbered feature folders and run Specify using each group's requirements.
6. **Develop the feature.** Review project rules, clarify uncertainties, plan the implementation, review checklists and analysis, and prepare tasks. Issue creation is available when appropriate.
7. **Implement.** Run the active coding agent against the feature. Inspect task progress and any question or attention message.
8. **Review and fix.** Run enabled review personas, apply targeted fixes to failed reviews, and inspect the Human Review Portal.
9. **Validate in the browser.** Prepare and start the project's preview, then run browser acceptance checks when the required Chrome tooling is available.
10. **Approve and operate.** Approve the implementation. Launch Deploy, Monitor, or Troubleshoot when needed. Feed later changes back into the requirements and specification cycle.

## Two valid entry paths

**Requirements first:** a meeting, PRD, transcript, or manually written list is converted into reviewed requirements, then features. This path retains requirement IDs and a feature-local copy of its source requirements.

**Feature first:** create a feature folder from Workflow, then run Specification with a description. This is useful when the feature is already understood. A manually created feature starts as a directory; creating it does not automatically generate a full set of template documents.

## Iteration is part of the lifecycle

Requirements can change after implementation. Linked requirement edits refresh the feature's requirements copy and can mark its specification stale. A rollback resets the selected phase's metadata and marks later approved phases stale. Existing artifacts remain available for inspection and revision. Rework should follow the affected phases and their dependencies.

# 03 | Installation, startup, and workspace setup

## Run the packaged app

The CLI starts the built Next.js application on loopback, uses port 18080 by default, and opens the browser. Use a port override if that port is occupied. Package installation and external CLI availability depend on the local environment.

```sh
npx speckit-assistant -w /path/to/project
npx speckit-assistant -w /path/to/project -p 18081
```

The workspace path is important: this is the folder whose specs, source code, requirements, and configuration the app will use. It does not have to be the Spec Rabbit source repository.

## Run this repository locally

```sh
pnpm install
pnpm dev
```

For a production build of this app:

```sh
pnpm build
pnpm start
```

`pnpm start` runs `next start` with Next.js defaults unless flags are passed. It does not automatically use the CLI's port 18080. To use that port explicitly, run `pnpm start --port 18080 --hostname 127.0.0.1`. The CLI launcher separately sets port 18080 and binds to 127.0.0.1.

Use a Node.js version supported by the installed Next.js and native dependencies. The repository README gives a broad Node prerequisite, but package/runtime compatibility should be checked against the actual installed versions rather than inferred from that badge.

## First-use sequence

1. Select or browse to the intended project using the workspace switcher. Confirm the current path before generating files.
2. Under Agents, configure a CLI profile and select it as active. Install and authenticate that CLI separately as required by its provider.
3. In Extensions, install the `specify` CLI if it is unavailable. The installer uses the Spec Kit source and can use a local virtual environment.
4. Use workspace setup to initialize Spec Kit for the active agent integration. Setup also attempts to install the Meeting Requirements extension.
5. Install Review Personas, Specification Agents, and DevOps Agents when those capabilities are wanted. Installing an extension makes commands available; enabling particular agents and applying hooks are separate choices.
6. Create or review the project constitution. Add API keys or Zoom settings only if the intended workflow uses them.

## Workspace switching and remembered state

The app remembers current and recent workspaces in `~/.speckit-assistant-config.json`. Switching updates the server's workspace selection and stops managed preview servers from the previous project. Removing a project from the recent list forgets that entry; it does not delete the project folder.

Workspace selection is shared by the server process. Treat an app instance as controlling one current project; independent browser tabs are not isolated project sessions. A running agent is a local process, and changing the visible section does not cancel it.

# 04 | Interface and everyday navigation

| Area | What the user does there |
| --- | --- |
| Workflow | Create and select features; use Kanban, DAG, or Executions; run and review phases. |
| Requirements | Import sources, edit requirement sets, adjust status and priority, group requirements, and create features. |
| Agents | Manage CLI profiles, the active agent, specification agents, review personas, DevOps agents, and assigned MCP servers. |
| MCP Tools | Define reusable MCP servers and configure the tools available to agent profiles. |
| Extensions | Install or manage bundled and community extensions, and install the specify CLI. |

## Workflow views

**Kanban** places feature cards at their current phase. A card's controls expose running, approval, rollback, Quick Build, review, and repair actions as applicable. Moving a card forward approves the intervening phases and launches the destination phase. Moving it to Completed approves the remaining phases. These are explicit workflow shortcuts, so read the artifacts before using them as sign-off.

Moving a card backward discards the selected target phase's state. Later approved phases become stale. The action does not restore an earlier Git commit or remove the existing generated documents.

**DAG** presents the workflow as a node-and-edge map. It helps users inspect phase relationships and select relevant artifacts. Its graph presentation does not itself execute an independent dependency scheduler.

**Executions** presents persisted runs, logs, durations, token estimates or parsed usage, exit codes, and costs where available. Its force-directed graph relates agent activity and features; it can be expanded for inspection. Specification hook runs inside a child Spec Kit process are not individually represented as first-class execution records.

## Working panels

The editor shows the selected Markdown artifact with formatting controls and preview support. Checklist directories can appear as multiple file tabs. Checkbox changes update the actual Markdown file. The file browser and Human Review Portal can show project files with syntax highlighting.

The **Agent Console** displays the current agent session and can forward interactive answers or terminal size changes. **Terminal** is a separate project shell, suited to ordinary commands. **Preview** starts and displays the application being developed. **Project chat** answers questions using collected project documents and streams its response.

## Expertise profile

On first use without a saved profile, the app can ask about technical experience and business-domain knowledge. It stores the result in workflow metadata and adapts supported prompts and report wording.

| Technical experience | Domain knowledge | Mode |
| --- | --- | --- |
| Technical | Has domain knowledge | Power User: standard technical language. |
| Technical | New to domain | Domain Transfer: explain business concepts. |
| Non-technical | Has domain knowledge | Business-Friendly: emphasize understandable outcomes. |
| Non-technical | New to domain | Full Guidance: explain business and technical context. |

This is communication guidance, not an access role or a different permission level. Support varies by prompt and entry point; it should not be assumed to rewrite every existing document.

# 05 | Capturing requirements from real inputs

## Supported intake paths

| Source | Processing path | Main dependency |
| --- | --- | --- |
| Zoom meeting link or ID | Resolve meeting and obtain available transcript or summary, then extract requirements. | Authorized Zoom integration; agent mode also needs assigned Zoom MCP tools. |
| VTT, text, or Markdown transcript | Normalize the uploaded text and extract structured requirements. | Working extraction engine. |
| Audio or video recording | Transcribe through OpenAI, format speaker/timestamp text, then extract requirements. | OpenAI API key; ffmpeg for automatic splitting of larger recordings. |
| Written requirements document | Convert supported document content to Markdown locally, then extract requirements. | Document reader and extraction engine. |
| Manual entry | Create a set and add requirements directly. | No AI extraction required. |

The document reader supports PDF, DOCX, PPTX, XLSX, OpenDocument formats, RTF, HTML, and EPUB. Scanned PDFs without a text layer are not an OCR workflow. Legacy binary Office formats should be converted to supported formats before upload.

In the current API, transcripts and documents have a 5 MB limit. Recording upload accepts up to 500 MB at the app boundary; transcription service limits still apply. The transcriber can split large media with ffmpeg. An app upload limit does not guarantee the downstream service can process the entire file in one request.

## Choose the extraction engine

**Agent engine:** the active CLI runs `/speckit.meetings.import` and `/speckit.meetings.group` from the bundled meetings extension. This reuses the coding-agent setup. For Zoom, assign the Zoom MCP server to the active agent and apply its configuration. The meetings runner checks readiness before spending a run.

**Direct engine:** the server calls the configured OpenAI, Anthropic, or Google provider using the user's API key and selected model. It requests structured output, validates it, and retries certain malformed results. Long text is chunked and extraction results are merged.

An explicit engine selection wins. Without one, configured API keys favor Direct mode; otherwise Agent mode is the default. Import can fall back from an unconfigured agent path to Direct mode when a usable API key is available. This fallback should not be assumed for every grouping operation.

## What an import creates

Each import gets a fresh requirement-set directory, usually a date and topic slug under `.specify/meetings/`. Depending on the source and engine, it retains normalized input, a converted `document.md`, transcript, summary, raw output, grouping files, and `requirements.md`.

Import progress can report resolving, transcribing, reading, fetching, extracting, and saving. The UI receives streamed progress and a terminal outcome, such as `ok`, `not_configured`, `no_transcript`, or `invalid_output`. An import does not immediately create implemented features.

Meeting imports add `.specify/meetings/` to the workspace Git ignore file. The files remain local, but AI extraction and transcription can transmit content to the selected external provider. Inspect the saved requirements before approving them.

# 06 | Requirement review, grouping, and traceability

## Anatomy of one requirement

| Field | Purpose |
| --- | --- |
| ID | Stable identifier such as REQ-001, allocated within its requirement set and not reused after deletion. |
| Title and description | What the capability or rule means. |
| Type | Functional, non-functional, constraint, assumption, or open question. |
| Priority | Must, should, could, or wont. |
| Status | Draft, accepted, or rejected. |
| Acceptance criteria | Observable conditions used to judge the delivered behavior. |
| Source | Optional timestamp, speaker, and supporting quote. |
| Feature link | Name of the feature created from the requirement. |

A requirement's status and priority are different decisions. Accepted means the reviewed item belongs in the agreed requirements. Priority indicates relative scope. An open question can be retained explicitly so that uncertainty reaches the Clarify phase instead of silently becoming an invented rule.

## Review procedure

Read each extracted item against its source. Remove duplicates, separate unrelated behaviors, correct domain terminology, and write measurable acceptance criteria. Accept items that match the intended scope and reject items that do not. Reorder or delete items as needed; the service also supports restoring a deleted item.

The Requirements screen is the normal review surface. Its Markdown source remains hand-editable. Requirement operations reread the file before applying changes, so previous disk edits can be incorporated.

## Create features from reviewed requirements

1. Select the intended requirements in a set. The intended user workflow uses accepted, unlinked requirements.
2. Ask for an AI grouping suggestion, or place the selection into one feature.
3. Review each proposed feature's title, name, summary, and requirement membership. Check for missing or overlapping scope.
4. Confirm creation. The service validates the groups and checks Spec Kit readiness before creating folders.
5. For each group, create the next numbered feature directory, link its requirements, save `specs/<feature>/requirements.md`, and run Specification.
6. Inspect the streamed result. If a feature has no generated `spec.md`, use Generate spec to retry that feature.

The core grouping service explicitly rejects already-linked and `wont` requirements. Accepted status is part of the intended review flow; do not treat it as a universal backend authorization barrier for all direct API calls.

## Traceability and later changes

Requirement IDs are preserved in the feature-local requirements copy and supplied to the spec-generation prompt. Open questions are passed as clarification items. IDs are local to a set, so retain the set reference when tracing across imports.

Changing a linked requirement's title, type, priority, description, or acceptance criteria refreshes the feature copy and flags existing specification work stale. Moving or removing a feature link also synchronizes affected copies. Status-only and ordering changes do not themselves change the content contract. Deleting a source set removes its meeting files; previously created features keep their own requirements copy.

The copy is a file available for version control. Creating it does not automatically make a Git commit.

# 07 | Development phases and their artifacts

The constitution applies to the workspace. The remaining phases apply to each feature. The UI and domain model retain the following phase order. Some commands have prerequisites that depend on generated artifacts; in particular, analysis may need a task list even though the displayed order places Analyze before Tasks.

| Phase | Agent command | Main output or evidence |
| --- | --- | --- |
| Constitution | /speckit.constitution | .specify/memory/constitution.md |
| Specification | /speckit.specify | specs/<feature>/spec.md |
| Clarification | /speckit.clarify | Clarifications section in spec.md, or clarification.md / clarify.md. |
| Planning | /speckit.plan | specs/<feature>/plan.md and related design artifacts. |
| Checklist | /speckit.checklist | checklist.md or one or more checklist directory files. |
| Analyze | /speckit.analyze | analysis.md when written; command behavior can also be report-oriented. |
| Tasks | /speckit.tasks | specs/<feature>/tasks.md |
| Tasks to Issues | /speckit.taskstoissues | External issue creation or command output; no standard local phase document. |
| Implementation | /speckit.implement | Source changes and task progress; no implementation.md is expected. |

## How to use the phases

**Constitution:** define shared principles, technical constraints, and quality expectations. Review it early because feature work should follow those rules. Discarding it marks approved feature phases stale across the workspace.

**Specification:** describe intended users, outcomes, scope, acceptance behavior, and uncertainties. Review the generated file before continuing. Optional specification agents can contribute business, architectural, refinement, and consolidation feedback through Spec Kit hooks.

**Clarification:** resolve ambiguous requirements with the agent. This is an interactive session. The UI forwards input to the live process; a Completion Report can automatically finish the phase. Finish closes the session and moves the phase to review. Approving or discarding also closes a still-open phase session.

**Planning:** describe how the feature will fit the existing project, including components, interfaces, persistence, and implementation work. Check consistency with the approved specification and constitution.

**Checklist and Analyze:** inspect requirement quality and cross-artifact consistency. Review all files in a checklist directory. If Analyze reports missing tasks, generate Tasks first and rerun Analyze before implementation. The displayed order should not override a command's real prerequisites.

**Tasks:** create a concrete Markdown checklist. Checkbox counts drive implementation progress signals. A marked checkbox is evidence recorded by a user or agent, not independent verification of the code.

**Tasks to Issues:** use when external issue tracking is part of the project. Tool access, repository context, and credentials must support that action. It is not required merely to view local tasks.

**Implementation:** build the feature using its approved documents and tasks. The service checks whether the run completed new task items. A zero exit code with no task progress returns an attention message rather than treating the feature as successfully built.

# 08 | Workflow state, approvals, rollback, and live sync

::: states

| State or flag | Meaning |
| --- | --- |
| idle | No active completed run is recorded for the phase, or it was reset. Existing files can later reconcile it to review. |
| running | An agent or review gate is in progress. A blocked review gate may remain in this state. |
| awaiting_review | The phase is ready for inspection; this is not human approval. |
| approved | A user or workflow action approved the phase. |
| skipped | Quick Build passed over the phase. It counts as done for progression. |
| stale | A separate flag indicates that previously produced or approved work needs reconsideration. |
| attention | A message explains why an implementation run needs input or did not show task progress. |

## Run lifecycle

When a phase starts, the service persists `running` and clears prior attention. It records an execution, starts the CLI, streams output, and captures logs and available usage. After the process finishes, it rereads disk state so that files written during the run are visible.

A successful normal run moves to `awaiting_review`. Implementation has extra progress checks and may enter the persona gate. A nonzero exit normally returns the phase to `idle`; execution history records the failure. Files already created by the failed process remain available. If the user already approved or discarded an active phase, that explicit state decision is preserved when the subprocess later finishes.

Approval marks the phase approved, clears its stale/attention indicators, persists state, and stops its associated live session. The service's direct approval action is permissive: a user can approve without an independent check that the expected artifact or tests exist.

## Rollback is metadata-driven

Discard resets the selected phase status and clears its current in-memory content reference, then marks **later approved phases** stale. It does not delete their files or restore source code. Because reconciliation rereads files, a retained artifact can reappear for review. Staleness is not applied indiscriminately to every later status.

Rolling back the constitution affects approved phases in every feature. Rolling back a feature phase affects that feature's downstream approved phases. Editing linked requirements uses a separate invalidation path that marks an existing specification stale and propagates to downstream approved work.

## Live updates and persistence

The server watches `specs/` and `.specify/` through chokidar. A Server-Sent Events connection sends fresh workflow state and the changed relative path. Important runtime state and execution-history changes are included; per-run log churn is excluded from this watcher to avoid excessive updates.

The UI refreshes relevant state and can reload a selected changed file. If the editor has no unsaved changes, it adopts the new content. If local edits diverge from the changed disk content, it shows an external-change banner with Reload from disk and Keep my changes. Keeping local changes dismisses the alert; it does not merge both versions. Review the difference before saving over a newer disk version. The implementation does not establish a general transactional editor lock or a complete automatic merge system.

Files determine artifact content and existence; `.specify/.runtime/workflow-state.json` preserves statuses, active feature, expertise settings, and selected metadata. A browser reload can reconstruct the board. Live PTY sessions and preview servers remain process-local; restarting the server is not a guarantee that interrupted runs resume or their old running labels are automatically reconciled.

# 09 | Implementation, review gates, and targeted fixes

## Normal implementation checks

The implementation service compares task counts before and after a run. No tasks, no newly completed tasks, or a checklist that was already fully checked can trigger an attention message. It may also surface the last question printed by the agent. Review that message, resolve the missing prerequisite or unanswered question, and rerun.

Task progress is a useful guard, but it is not a correctness proof. A run that checks at least one task can still require further implementation. Review incomplete tasks, diffs, and test results before approval.

## Quick Build

Quick Build starts from a feature with an existing specification and no running phase. It approves the spec, marks unfinished intermediate phases skipped, marks the implementation as a quick build, and starts coding. If no tasks file exists, the agent is instructed to create one first so that progress can be tracked.

This is useful for a small, already understood feature. It still uses implementation progress checks and enabled review personas. Skipped phases can be run later. It does not imply that planning or quality checks were independently completed.

## Automated review gate

Enabled personas run in canonical order: **QA → Code Review → Security → Tech Lead**. Disabled personas are omitted. The bundled defaults and workspace configuration determine which actually participate; all four are not automatically active.

Before running a gate, the service checks installed extensions for the enabled persona commands. Missing or disabled commands produce an unavailable/setup condition rather than an improvised review. Install or enable the extension and rerun the gate.

Each persona writes a report, normally `specs/<feature>/reviews/<persona>.md`. The service looks for an explicit `VERDICT: PASS` or `VERDICT: FAIL` in its report or final output. Missing verdicts count as failure. A clean process exit alone is insufficient for the persona verdict; report interpretation is the gate's deciding signal.

The first failed review stops the sequence and leaves implementation in the gate's running/blocked condition. Once all enabled reviewers pass, the phase becomes `awaiting_review` for the human. Automated review is distinct from final human approval.

## Fix & Retry

1. Read the failed report and its blocking findings. Edit the suggested fix instruction if necessary.
2. Launch Fix & Retry. The service appends a numbered entry to `specs/<feature>/patch-notes.md`.
3. A targeted fix run receives the failed report, the instruction, and accumulated patch notes.
4. The failed persona runs again. If it fails, the gate stays blocked.
5. If it passes, the remaining reviewers after it run in order. The gate returns to human review after those pass.

Earlier passed personas are not automatically rerun by this targeted continuation. If a fix changes their review scope, rerun the full gate or appropriate checks before approving.

## Human Review Portal

Inspect the changed-file list, Git diff, recent commits, project tree, review reports, and available timing/cost data. The tree excludes large generated/dependency directories and is capped for responsiveness. Markdown can be viewed rendered or raw; code files have syntax highlighting.

Human approval updates workflow state. It does not itself commit, merge, open a pull request, or deploy the project. Those actions require the relevant separate tooling or agent instruction.

# 10 | Live preview and browser acceptance tests

## Preview lifecycle

Preview runs the application being developed beside the workflow. It is distinct from the Next.js server hosting Spec Rabbit itself.

1. Choose Prepare preview. The active agent inspects the project and writes `.specify/preview.json` with a foreground command, optional relative working directory, port, page path, and notes.
2. Inspect or manually edit that configuration. For example, a project may use `pnpm dev --port {port}` with a path such as `/signup`.
3. Start preview. The runner launches the configured command, captures output, discovers a local server URL, and exposes status and logs.
4. Use the displayed page or open the preview separately. Start, stop, or restart when needed.
5. If startup fails, choose Fix preview. The agent receives the command, output, and error, then updates the setup or configuration.

Preview states are stopped, starting, running, and failed. The relative working directory must stay inside the project. Agent preparation and repair are tracked executions; simply having valid preview configuration is not evidence that every feature works.

## Browser-test lifecycle

Browser tests connect requirement acceptance criteria to observable behavior in a running application. The current integration uses Claude-in-Chrome MCP tooling. It is not established as a provider-neutral browser-testing implementation.

1. Start the project and supply its actual reachable URL. The default test URL is `http://localhost:3000`; the current browser-test service uses that URL and does not independently start a dev server just because a server command exists in the config type.
2. Ensure the expected Chrome extension and MCP connection are available for the selected agent environment.
3. Launch the test for a feature. The service reads its feature-local `requirements.md`, builds a criteria-based prompt, and launches a restricted agent command.
4. The agent attempts to confirm browser connectivity, navigate the app, perform relevant actions, and write `specs/<feature>/browser-test-report.md`.
5. The service parses report sections into requirement IDs, criterion text, pass/fail/skipped statuses, and evidence. Review the report and fix failed criteria.

## How to interpret the result

The service initially reports Chrome connection as unknown; the real check is deferred to the agent. A report mentioning no connected browser produces `chrome-not-connected`. An agent failure with no report produces `failed`.

**Completed means that the reporting path completed; it does not mean every acceptance criterion passed.** Current execution history marks a completed browser-test run passed even if parsed criteria include failures. A successful exit without a useful report can also leave little evidence. Always inspect the criterion results, report content, and actual coverage before human sign-off.

Features without a requirements copy may provide no criteria to this path. Add or restore meaningful acceptance criteria before treating a browser test as useful validation. The current prompt/tool-list combination also relies on the installed Chrome tooling supporting its connectivity check, so use the console log to diagnose connection failures.

# 11 | Agents, extensions, MCP, and integrations

## Active CLI agent

Agent profiles are saved in `.specify/agents.yaml`. A profile carries an ID, display name, agent type, optional executable path or custom command, model hint, and MCP server assignments. The active profile drives normal UI workflow runs.

Supported runner types include Claude, Gemini, Copilot, OpenAI/Codex, and custom commands. The internal `openai` agent type invokes the `codex` CLI. Each CLI needs its own installation and authentication. A configured API key for Direct extraction does not replace a missing coding-agent executable.

Phase commands are translated to the invocation format supported by the workspace integration. The process runner uses a pseudoterminal for live output and interactive sessions, with CLI-specific argument handling. General Claude workflow runs currently use `bypassPermissions`; restricted Claude operations use an explicit allowlist and `dontAsk`. Restriction behavior should not be assumed identical for every provider.

Model fields are metadata or hints whose effects depend on the runner and command. For ordinary phase runs they are used for pricing estimates; do not assume that changing a profile's model always forces the installed CLI to switch models.

## Extensions and specialist rosters

| Bundled extension | Adds |
| --- | --- |
| Meeting Requirements | Agent-driven import and requirement grouping commands. |
| Specification Agents | Product Owner, Architecture, Technical Refinement, and Consolidate commands. |
| Review Personas | QA, Code Review, Security, and Tech Lead review commands. |
| DevOps Agents | Deploy, Monitor, and Troubleshoot commands. |

Extensions are installed in the workspace through Spec Kit, with a registry and extension definitions. The UI also supports community sources such as URLs or ZIP packages, plus enable/disable and removal operations.

Specification agents are configured in `.specify/spec-agents.yaml`. Applying them writes the Spec Kit hook configuration for `after_specify`, including priority and whether the hook is optional. Enabled, optional, and automatically executed are different settings. Hook actions run inside Spec Kit's subprocess and are not individually tracked by Spec Rabbit's execution history.

Review and DevOps rosters are separate from those hooks. Review personas govern the implementation gate; DevOps agents are launched on demand.

## MCP configuration

Define MCP servers centrally in `.specify/mcp.yaml`, assign them to profiles, then apply the selected profile's configuration. The adapter translates supported definitions into CLI-native formats, including Claude `.mcp.json`, Gemini settings, and Codex TOML. It merges existing configuration and creates backups rather than assuming it owns the entire file.

Some CLI-native files are under the user's home folder, so applying config can affect that CLI beyond one project. Server definitions may reference environment variables. Assigning a server to a profile is distinct from applying it to the executable's native configuration.

## Zoom and AI settings

Integration settings store provider keys/models, engine selection, Zoom client configuration, and OAuth tokens. API keys can also come from `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`. Recording transcription always resolves an OpenAI key, regardless of the chosen extraction provider.

Zoom setup uses a user-managed OAuth app and a public HTTPS callback address routed to `/api/integrations/zoom/callback`. The implementation supports authorization state and token refresh. Add the Zoom MCP definition and assign it for Agent mode. Fresh Zoom access tokens can be injected into agent runs through the configured environment variable. Use Settings connection testing to inspect available tools; source coverage depends on the account and its available meeting assets.

# 12 | Architecture and request lifecycle

The app uses a ports-and-adapters structure. Domain models and services express workflow behavior; ports define interfaces; adapters implement filesystem access, CLI execution, API providers, Zoom, preview processes, and HTTP/UI integration.

::: architecture

| Layer | Main implementation |
| --- | --- |
| Browser | React 19 components, Kanban, ReactFlow DAG, execution graph, Markdown editor, xterm console, and preview. |
| HTTP entry points | Next.js 15 route handlers under src/app/api and local-access middleware. |
| Application services | WorkflowService, RequirementsService, MeetingImportService, FeatureCreationService, PreviewService, BrowserTestService, and ChatService. |
| Outbound ports | Workspace repository, agent runner, execution history, LLM, credential store, meeting source, transcriber, document reader, and preview runner. |
| Infrastructure adapters | Filesystem repositories, node-pty CLI processes, provider SDKs, Zoom MCP/OAuth, officeparser, and preview subprocesses. |
| Composition root | src/adapters/di.ts constructs shared service and adapter instances. |

## Example: Run Planning

1. The user selects a feature, supplies optional instructions, and clicks Run for Planning.
2. The browser posts a phase action and agent configuration to `/api/phase`.
3. Middleware checks the addressed host and the origin of state-changing API requests.
4. The route resolves the current workspace and invokes `WorkflowService.runPhase`.
5. The service saves running status and starts an execution record. The runner invokes the configured CLI in the workspace with the phase command and context.
6. CLI output is streamed through SSE `log` events and written to the execution log. The agent can write `plan.md` and related project artifacts.
7. The file watcher emits workflow updates as watched artifacts change. This is separate from the run's own output stream.
8. When execution ends, the service reconciles files, records exit/usage metadata, updates the phase, and sends a `done` event with final state or an `error` event.
9. The user reviews the result and posts an approval or discard action.

## Process boundaries

HTTP routes coordinate work inside one local server process. Agent CLIs and preview commands run as child processes. Some session maps are preserved through development module reloads using process-global storage, but not through a full process restart.

SSE is a one-way server-to-browser progress channel. Interactive user input travels through separate HTTP actions that write to the active PTY. Terminal sessions use their own stream, input, and resize routes.

The filesystem repository combines live Markdown content with saved metadata. There is no application database service in this design. Git history, source files, and generated reports remain separate forms of evidence.

# 13 | Data storage, privacy, and access boundaries

## Workspace storage map

```text
project/
  .specify/
    memory/constitution.md
    templates/ and scripts/      # Spec Kit initialization
    agents.yaml                 # CLI profiles and active selection
    mcp.yaml                    # central MCP definitions
    personas-config.json        # review gate configuration
    spec-agents.yaml            # specification hook roster
    devops-agents.yaml           # operational agent roster
    preview.json                # project preview command
    extensions/                 # installed extensions and registry
    meetings/<set-id>/          # local imported sources and requirements
    .runtime/
      workflow-state.json       # statuses and workflow metadata
      executions.jsonl          # append-only execution snapshots
      logs/<execution-id>.log   # per-run captured output
  specs/<feature>/
    requirements.md             # feature-local source requirements
    spec.md
    plan.md
    checklist.md or checklists/
    analysis.md
    tasks.md
    reviews/<persona>.md
    patch-notes.md
    browser-test-report.md
    devops/                     # operational reports when produced
```

The names above describe supported/common artifacts. Agents and commands can produce additional files. A feature folder does not start with every listed file.

## User-level storage

`~/.speckit-assistant-config.json` remembers workspace selection and recent projects. `~/.speckit-assistant/credentials.json` stores integration secrets with file mode 0600. Credentials are outside the workspace, and settings responses expose presence flags or hints instead of full secret values.

CLI authentication and some native MCP config live in the external tools' own locations. Those are distinct from the app's credential store. Back up project artifacts through normal project practices; treat secret storage separately from shareable project documentation.

## Local access model

The CLI binds its server to 127.0.0.1. Middleware accepts loopback hostnames by default and checks origins on state-changing API requests. `SPECKIT_ALLOWED_HOSTS` is an explicit host allowlist extension. The one public-route exception is GET on the Zoom OAuth callback.

This is a local control plane with filesystem, shell, and credential access. The source does not define a hosted multi-user account model, role-based permissions, team tenancy, or a remote collaboration backend. The expertise profile changes guidance; it is not authorization.

Local storage does not mean all processing stays on the computer: provider calls, agent CLIs, transcription, Zoom access, MCP servers, and deployments can communicate with external systems. Project chat sends collected documents to the configured API provider.

## Retention and deletion behavior

Deleting a feature recursively removes its feature folder and updates the workflow selection. It does not undo code changes elsewhere in the project. Deleting a requirement set removes its source folder but leaves already-created feature copies. Forgetting a recent workspace does not delete files. Rollback does not erase artifacts. Logs and imported material remain ordinary local files unless explicitly removed.

# 14 | Execution history, costs, terminal, and project chat

## Execution records

Tracked kinds include phase, persona, DevOps, meeting, preview, fix, and browser-test. A record includes its ID, kind, feature if applicable, label, optional phase or command, running/passed/failed status, timestamps, exit code, log path, and available cost metadata.

History is append-only JSONL. A start snapshot is followed by a finish patch; reads merge entries by ID into the latest record. Logs are written separately. This supports inspection after a page reload without making process state durable across a server restart.

Execution success is scoped to the kind of run. A phase's passed process record still requires workflow review; persona status comes from report verdicts; browser-test completion must be checked against individual criteria. Grouping and import can have their own tracked meeting-kind runs.

## Cost and duration

Where a CLI exposes usage, the app parses it. Otherwise it estimates token/cost usage using I/O volume and the repository's pricing table. The UI distinguishes parsed from estimated values. Model hints and configured defaults influence estimates, so figures should be treated as operational guidance rather than a billing statement.

Duration is measured from the run's timestamps. Not every operation is separately metered: specification hooks execute inside another process, and current project chat does not write execution-history records. Direct provider operations can have different cost capture from CLI runs.

## Terminal

The Terminal panel opens a login shell in the current workspace through node-pty. Input and resize requests reach the shell, while output arrives through SSE. The shell can remain alive when its UI listener closes. On the next access after a workspace change, the manager replaces the old shell with one in the new project.

The terminal is separate from a workflow agent session. Typing a command there does not automatically create an app execution-history entry or approve a phase. Files written by terminal commands can still be discovered through filesystem reconciliation.

## Project chat

The chat service collects the constitution, feature overview, feature specs, requirements, plans, tasks, analysis files, and meeting requirement lists. It builds a project-context prompt, adds the conversation messages, calls the configured API provider, and streams text tokens to the panel.

Each source file is limited to 12,000 characters for context collection. There is no demonstrated global context-budget or retrieval ranking system, so large projects may exceed provider limits. The chatbot is instructed to answer from supplied context, admit missing information, and remain read-only; it has no file-editing tool path in this service.

Chat needs an API key even when the requirements engine is Agent mode. A CLI login alone is insufficient. The current panel holds conversation messages in React memory and offers Clear chat; no durable chat-history store is implemented here. Use the project documents for facts the chat context does not include, such as source-level runtime behavior or omitted file sections.

# 15 | Deployment, monitoring, maintenance, and shutdown

## App hosting and project deployment are different

Starting Spec Rabbit serves the local orchestration UI. Starting Preview runs the application being built. Running Deploy asks a DevOps agent to perform a project-specific deployment. These three processes have different purposes and must not be confused.

## Operational agents

DevOps profiles are stored in `.specify/devops-agents.yaml`, backed by the bundled DevOps extension. Launch them on demand from the execution-oriented UI. A run can target one feature or the whole workspace.

| Agent | Intended operation | Review the resulting evidence |
| --- | --- | --- |
| Deploy | Prepare and perform deployment according to project configuration and instructions. | Target environment, commands, build result, deployment URL, and produced report. |
| Monitor | Inspect post-deployment health and relevant signals. | Checked endpoints, errors, service status, and unresolved observations. |
| Troubleshoot | Investigate a reported operational issue. | Reproduction evidence, diagnosis, recommended or applied changes, and remaining gaps. |

These are agent commands, not a built-in universal hosting platform or continuous monitoring daemon. Available credentials, tools, project scripts, and prompts determine what the agent can do. Successful implementation does not automatically trigger deployment or monitoring.

The service records an operational run's status and log but does not advance feature phase state. An exit code is a process signal; verify the target system and agent report before treating deployment as successful.

## Change lifecycle after release

1. Record a defect, new requirement, or operational finding.
2. Update the appropriate requirement or create a new feature for a separate scope change.
3. Review stale specifications and affected approved phases. Update plans, tasks, and implementation as needed.
4. Rerun relevant automated checks, persona reviews, and browser acceptance criteria.
5. Approve the change and explicitly deploy through the project's chosen process.

The app does not automatically roll back production when a workflow card is moved backward. Production rollback requires project-specific deployment tooling and instructions.

## Pausing and shutting down

Use Stop for a live phase session and inspect its resulting files and log. Use Finish for an interactive phase ready to leave the console and enter review. Stop preview when it is no longer needed. Save editor changes before closing the page.

A disconnected browser does not necessarily cancel a phase or import: those routes are designed to keep server-side work going. A full server stop interrupts process-local coordination; after restart, inspect history and artifacts before rerunning unfinished work. Do not assume a running history entry means an old process is still active.

# 16 | Worked scenarios and alternate paths

The following examples demonstrate intended use with illustrative shopping-app requirements. Outcomes depend on the actual project, agent output, and validation results.

## Scenario A: Meeting to a reviewed feature

**Starting point:** a project has a working coding agent, initialized Spec Kit, and the meetings extension. A weekly meeting transcript says customers should see previous orders and filter by date.

1. Open Requirements and import the VTT transcript. Name the set Order history discussion.
2. Inspect the extracted items. Correct the meaning of customer, define date boundaries, and retain an open question about cancelled orders.
3. Accept REQ-001 for viewing order history and REQ-002 for date filtering. Write observable criteria, including the empty-history case.
4. Choose Create features, review the proposed grouping, and combine these items into Order history if they form one coherent feature.
5. Confirm. The app creates a numbered folder such as `specs/004-order-history/`, saves the requirements copy, links the source items, and runs Specify.
6. Review the spec, run Clarify to answer the cancelled-order question, and approve the result. Generate Planning, Checklists, and Tasks; run Analyze when its prerequisites exist.
7. Run Implementation. Inspect code and task progress. Let the enabled review gate run; use Fix & Retry if a reviewer finds a blocking defect.
8. Prepare Preview and start the project. Run browser criteria for viewing history, filtering, and an empty result. Inspect each test outcome.
9. Open Human Review, inspect the diff and reports, and approve implementation. Run Deploy separately if release is intended.

**Expected record:** local source transcript and requirement set, feature-local requirements/spec/plan/tasks, implementation changes, execution logs, review reports, and browser-test report when generated.

## Scenario B: A written PRD instead of a meeting

**Starting point:** a product owner has Checkout PRD.pdf with selectable text and a configured Direct provider.

1. Upload the PDF from the File import path. The app converts it locally to Markdown and retains `document.md` in the new set.
2. Review extracted functional requirements, constraints, and assumptions. Verify that table content and numbers survived conversion correctly.
3. Accept the intended items, propose grouping, and split payment handling from address entry if they are independently deliverable features.
4. Create the features and follow their normal specification and implementation lifecycle.

**Alternate outcome:** a scanned PDF produces no usable text. Export a text-bearing document or provide a transcript/manual requirements; this build does not supply OCR.

## Scenario C: Local recording without cloud Zoom assets

**Starting point:** a meeting was recorded locally as M4A. The workspace uses Agent extraction, and an OpenAI key is also configured.

1. Upload the recording. OpenAI transcription produces speaker/timestamp text.
2. The chosen extraction engine converts that text into requirements. Review speaker attribution and domain terms carefully.
3. Continue with acceptance, grouping, and feature creation.

**Alternate outcome:** a large recording needs splitting but ffmpeg is missing, or no OpenAI key is available. Follow the transcription error, configure the missing dependency, or upload an existing VTT/TXT transcript. Switching the extraction provider alone does not replace the OpenAI transcription requirement.

## Scenario D: A small feature using Quick Build

**Starting point:** a developer creates a feature and writes a clear specification for a small copy-to-clipboard action.

1. Review the specification and select Quick Build.
2. The app approves the specification and skips unfinished intermediate phases. The agent creates tasks if needed, then implements.
3. Check task progress and the diff. Run the configured gate and validate the interaction in preview.
4. Approve after sufficient evidence. Return to skipped phases later if the feature needs more formal design or analysis.

**Alternate outcome:** the agent exits without creating tasks or checking new tasks. Implementation returns an attention message. Inspect the log and rerun with the missing prerequisite resolved.

## Scenario E: Security review blocks implementation

**Starting point:** implementation progressed, QA passed, and the enabled Security persona reports an exposed token with `VERDICT: FAIL`.

1. Read the report and choose Fix & Retry with a precise instruction to remove the exposure and use the project's secret mechanism.
2. The app appends a patch note, runs a targeted fix, and reruns Security.
3. If Security passes, remaining reviewers continue. If it fails, inspect the new findings and repeat a justified targeted fix.
4. If the fix affects earlier reviews, rerun those checks or the full gate before human approval.

**Expected result:** a traceable repair log and amended report. A passed fix process alone is not the final gate verdict.

## Scenario F: Requirements change after approval

**Starting point:** Order history is approved. The product owner changes the date filter criterion to use the customer's timezone.

1. Edit the linked requirement's acceptance criteria in Requirements.
2. The feature-local requirements copy is refreshed, its existing specification is flagged stale, and later approved phases are marked stale.
3. Revise and review the spec, plan, and affected tasks. Implement the change and test timezone boundaries.
4. Rerun relevant reviews and approve the updated work. Deploy explicitly if the running environment must change.

**Expected result:** the previous implementation remains available while stale markers direct the next review cycle. No production rollback occurs just from this edit.

## Scenario G: Reload or server interruption during a run

**Starting point:** Planning is running when the browser tab is closed.

1. Reopen the app. The server-side run may still be working; inspect Executions and current phase state before starting a duplicate.
2. If the server itself restarted, inspect `plan.md`, the execution log, and whether any process remains active.
3. Reconcile unfinished work through review, reset, or rerun as appropriate. A saved running record does not resume the old agent.

## Scenario H: Business user asks project chat a question

**Starting point:** requirements and specs exist, and an API provider key is configured. The expertise profile is Business-Friendly.

1. Ask, Which customer actions are included in order history?
2. Chat collects current project documents and streams an answer from the configured API model.
3. Check the relevant spec if the answer matters for scope. Ask about missing requirements explicitly; chat is instructed to admit missing context.

**Expected result:** an explanation without code edits. Reloading the page can clear the current in-memory conversation.

# 17 | Failure handling and practical troubleshooting

| Symptom | Likely cause | Next action |
| --- | --- | --- |
| App says local access only or returns 403. | Request uses a non-loopback host or disallowed origin. | Open localhost on the app machine; use the explicit host setting only for an intentional environment. |
| Agent cannot start. | Missing executable, incorrect path, or provider login. | Check the active profile and run its CLI from the project terminal. |
| Feature creation reports Spec Kit missing. | Workspace lacks the expected initialized templates/scripts. | Run workspace setup or initialize Spec Kit in the selected project. |
| Review persona is unavailable. | Its extension command is missing or disabled. | Install or enable Review Personas and rerun the gate. |
| Implementation exits cleanly but stays idle with attention. | No tasks or no new checked tasks; unanswered agent question. | Inspect tasks and console, correct prerequisites, and rerun. |
| Persona fails despite a zero exit code. | Report says FAIL or has no explicit verdict. | Read the report, repair the findings, and rerun with a valid verdict. |
| Zoom meeting has no transcript. | Meeting assets are absent, inaccessible, or unsuitable for the account. | Check the connected account and use an uploaded transcript/recording when needed. |
| Zoom link is unsupported. | Recording-share or personal-room input cannot be resolved as the supported meeting input. | Upload a downloaded transcript or use a supported meeting link/ID. |
| Recording import asks for an OpenAI key. | Speech-to-text uses OpenAI even with another extraction engine. | Add that key or upload an existing transcript. |
| Document import has little or no text. | Scan-only PDF, unsupported format, conversion issue, or empty content. | Provide selectable text in a supported document or enter requirements manually. |
| Preview does not start. | Missing command, invalid working folder, port conflict, or project startup failure. | Inspect preview logs and config; use Fix preview or correct the command. |
| Browser test says Chrome not connected. | Required extension/MCP session is unavailable. | Connect the expected Chrome tooling and inspect the agent's first tool calls. |
| Browser test completed but feature still fails. | Completion status differs from per-criterion outcomes, or report coverage is incomplete. | Read every criterion and evidence section; repair and rerun. |
| Project chat asks for a key. | Chat uses Direct API credentials, separately from CLI login. | Configure the selected provider key in integration settings. |
| Chat misses details. | File truncation, absent documents, or model context limits. | Check source documents and ask a narrower question; do not infer source-code knowledge. |
| Board still shows running after restart. | Process metadata survived but the process did not. | Check logs/processes and reset or rerun deliberately. |
| External edits refresh an open file. | The watcher observed a disk change. | Inspect your unsaved editor work and reconcile changes before saving. |

## Evidence to collect before retrying

Record the current workspace path, feature name, phase, active agent, execution ID, final log lines, exit code, relevant report, and whether the expected file exists. For import failures, retain the terminal status and source type. For previews, inspect both configuration and startup output. This normally distinguishes setup failures from invalid generated output and genuine project defects.

## Current implementation limits

The app coordinates local files and tools; it does not guarantee transactional multi-user editing, durable process recovery, universal agent-tool compatibility, automatic production rollback, or complete browser-test coverage. Its direct approval actions are intentionally flexible. Git diffs, task checkboxes, persona reports, and browser criteria each provide partial evidence that the user must interpret together.

The build configuration currently permits TypeScript build errors and ignores lint failures during Next.js builds. A successful build therefore does not establish that separate type checks or tests passed. Historical README coverage numbers are not a fresh validation result for this source snapshot.

# 18 | API, CLI, glossary, and source reference

## HTTP route map

These routes are a compact implementation reference, not a versioned public API contract. The selected workspace is normally resolved on the server. JSON mutations and SSE runs share some paths; consult the route handler before building an external client.

| Route family | Purpose |
| --- | --- |
| /api/state; /api/state/watch | Read/select workflow context; stream filesystem-driven state updates. |
| /api/workspace; /browse; /init | Describe/switch/forget workspaces, browse folders, and initialize Spec Kit. |
| /api/feature | Create or delete feature folders. |
| /api/phase | Run, approve, finish, discard, stop, send input, resize, run gate, Quick Build, and fix. |
| /api/file; /api/file/tree; /api/task | Read/write workspace files, browse the tree, and toggle checkboxes. |
| /api/meeting/import | Import sources with streamed progress and a terminal outcome. |
| /api/requirements; /sets | Requirement CRUD and requirement-set lifecycle. |
| /api/requirements/readiness; /grouping; /features | Check setup, propose groups, create features, and regenerate specifications. |
| /api/agents; /personas; /spec-agents; /devops-agents | Manage CLI profiles and specialist rosters. |
| /api/spec-agents/apply; /api/extensions | Apply hooks and manage extension tooling. |
| /api/mcp; /api/mcp/apply | Save shared MCP definitions and apply profile assignments. |
| /api/settings/integrations; /api/llm/models | Configure integration settings and query models. |
| /api/integrations/zoom/* | Connect, complete callback, disconnect, and inspect tools. |
| /api/executions; /api/executions/log | Read history and saved run output. |
| /api/devops/run | Stream an operational agent run. |
| /api/preview; /api/preview/agent | Configure/start/stop preview and run preparation or repair. |
| /api/browser-test | Stream feature browser acceptance testing. |
| /api/chat; /api/expertise | Stream project Q&A and save the user guidance profile. |
| /api/git | Inspect project status, diff, history, and branch context. |
| /api/terminal/stream; /input; /resize | Terminal output, keyboard input, and dimensions. |

Paths abbreviated after a semicolon or slash are suffixes of the same family, except where a full `/api/` path is supplied.

## CLI examples

```sh
speckit-assistant -w /path/to/project -p 18080
speckit-assistant status -w /path/to/project
speckit-assistant create 004-order-history
speckit-assistant run specification 004-order-history --agent claude
speckit-assistant approve specification 004-order-history
speckit-assistant discard planning 004-order-history
speckit-assistant import meeting.vtt --title "Order history discussion"
speckit-assistant requirements
speckit-assistant requirements 2026-11-13-order-history-discussion
speckit-assistant create-features 2026-11-13-order-history-discussion
```

Run CLI operations in the intended project or pass `-w`. The executable also exposes deletion and phase prompts; use its help output for the exact installed version. CLI agent options may be explicit rather than identical to the UI's active-profile defaults.

## Glossary

| Term | Meaning in this app |
| --- | --- |
| Workspace | The selected project folder under local orchestration. |
| Requirement set | A source list under .specify/meetings with set-local requirement IDs. |
| Feature | A directory under specs/ with its development artifacts and phase metadata. |
| Constitution | Project-wide rules applied across feature work. |
| Phase | One workflow activity such as Specification or Planning. |
| Agent profile | A persisted definition of a coding CLI and its assigned tool servers. |
| Persona | A specialized implementation reviewer with a pass/fail report. |
| Hook | A Spec Kit action associated with an event such as after_specify. |
| MCP | Model Context Protocol, used to connect tool servers to agents/integrations. |
| SSE | Server-Sent Events, used for live server-to-browser updates. |
| PTY | Pseudoterminal supporting a real terminal-like CLI session. |
| Stale | Existing work flagged for reconsideration after an upstream change. |

## Source anchors used for this guide

- Product and baseline architecture: `README.md`, `package.json`, `docs/adr-001-hexagonal-architecture.md`, and `docs/adr-002-state-sync-and-agent-dispatch.md`.
- Meeting architecture evolution: `docs/adr-003-meeting-requirements.md` and `docs/adr-004-agent-meetings-extension.md`. Current code takes precedence where earlier ADR designs differ.
- Interface and actions: `src/app/page.tsx` and `src/components/`, especially KanbanBoard, RequirementsSection, HumanReviewModal, PreviewPanel, ChatPanel, and ExpertiseAssessmentModal.
- Workflow lifecycle and state: `src/domain/services/WorkflowService.ts`, `src/domain/models/types.ts`, and `src/adapters/secondary/fs/FSWorkspaceRepository.ts`.
- Requirements pipeline: `MeetingImportService.ts`, `RequirementsService.ts`, `FeatureCreationService.ts`, `MeetingAgentRunner.ts`, `featureGrouping.ts`, and the requirement/transcript helpers under `src/domain/services/`.
- Runtime execution: `src/adapters/secondary/agent/ProcessAgentRunner.ts`, `src/adapters/secondary/fs/FSExecutionHistory.ts`, `src/domain/models/executions.ts`, and `src/adapters/di.ts`.
- Preview and tests: `src/domain/services/PreviewService.ts`, `BrowserTestService.ts`, `browserTestPrompt.ts`, and `src/adapters/secondary/preview/ProcessPreviewRunner.ts`.
- Chat and credentials: `src/domain/services/chat/`, `src/domain/services/IntegrationsService.ts`, `src/domain/models/credentials.ts`, and `src/adapters/secondary/fs/FSCredentialStore.ts`.
- Local access and HTTP behavior: `src/middleware.ts`, `src/app/api/`, `src/adapters/primary/api/terminalManager.ts`, and `src/bin/cli.ts`.

To revise this document, update this Markdown source and regenerate the companion PDF with `docs/build_lifecycle_pdf.py`. The PDF is a description of the inspected implementation, not a certificate of external integration or deployment success.
