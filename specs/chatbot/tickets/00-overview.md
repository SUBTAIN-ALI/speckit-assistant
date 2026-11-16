# Chatbot Feature — Ticket Overview

## Architecture Summary

The **Project Knowledge Chatbot** is an isolated, read-only module embedded in Spec Rabbit. It helps users understand their selected project before making development decisions. It uses the user's configured AI CLI tool (Claude, Copilot, Gemini) behind the scenes to answer questions by examining project files, specs, and domain knowledge.

### Key Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend | AI CLI invocation (not direct LLM API) | Agent reads files itself — better accuracy, code search, git history |
| Data location | `.specify/chatbot/` inside user project | User owns their data; portable with the project |
| Conversation TTL | 7 days, auto-pruned | Keeps storage bounded; chatbot is for understanding, not archival |
| Code isolation | `src/chatbot/` — independent module | No coupling with SDD pipeline; delete folder = no chat, rest works |
| Host interface | `ChatbotHostPort` — thin port | Chatbot imports nothing from `src/domain/`, `src/components/`, `src/adapters/` |
| UI | Single `ChatPanel` with resizable/expandable modal | Simple, one conversation view with expand toggle |
| Skill install | None — Spec Rabbit injects read-only prompt internally | No user-level skill installation needed |

### Folder Structure

```
src/chatbot/
  domain/
    models.ts                    # Conversation, Message, KnowledgeTopic, Citation types
    ports.ts                     # ChatbotHostPort interface (what chatbot needs from host)
    ChatbotService.ts            # Orchestrates Q&A via agent CLI
    ConversationStore.ts         # Conversation CRUD + 7-day TTL
    KnowledgeService.ts          # Topic knowledge CRUD + approval + conflict
  adapters/
    FSConversationStore.ts       # File-based conversation persistence
    FSKnowledgeStore.ts          # File-based topic knowledge persistence
    ChatbotAgentRunner.ts        # Wraps ProcessAgentRunner with read-only enforcement
    FileAccessGuard.ts           # Exclusion rules for secrets, node_modules, etc.
  components/
    ChatPanel.tsx                # Main chat UI (replaces current src/components/ChatPanel.tsx)
    ChatExpandedModal.tsx        # Expanded/resizable view wrapper
    KnowledgeApprovalModal.tsx   # Before/after preview for domain knowledge saves
    ConversationList.tsx         # History browser with 7-day window
    CitationView.tsx             # Toggleable source citation display
  api/
    handlers.ts                  # Route handler logic (imported by src/app/api/chatbot/)
  index.ts                       # Public API — ONLY export consumed by host app
```

### Data Layout in User Project

```
.specify/chatbot/
  conversations/
    <uuid>.json                  # { id, createdAt, updatedAt, messages[], projectPath }
  knowledge/
    <topic-slug>.md              # User-approved domain knowledge (Markdown)
```

### Dependency Graph

```
Ticket 01 (Models + Ports)
  ├── Ticket 02 (Conversation Store)
  ├── Ticket 03 (Knowledge Store)
  ├── Ticket 04 (Agent Runner)
  │     └── Ticket 05 (Chatbot Service)
  │           └── Ticket 06 (API Routes)
  │                 └── Ticket 07 (DI Wiring)
  │                       └── Ticket 08 (ChatPanel UI)
  │                             ├── Ticket 09 (Expand/Resize)
  │                             ├── Ticket 17 (Stop/Regenerate/Cancel)
  │                             └── Ticket 18 (Conversation History Browser)
  ├── Ticket 11 (Knowledge Upload)
  │     └── Ticket 10 (Knowledge Approval Modal)
  │           └── Ticket 12 (Knowledge Conflict Resolution)
  ├── Ticket 13 (Citations)
  │     └── Ticket 14 (Evidence Distinction)
  ├── Ticket 15 (File-Access Exclusions)
  ├── Ticket 16 (Concurrent Implementation Awareness)
  └── Ticket 19 (Git History)
```

### Requirements Document Reference

Source: `Spec_Rabbit_Project_Chatbot_Requirements.docx` (Version 1.0, 16 November 2026)
Location: `/Users/apple/Downloads/Spec_Rabbit_Project_Chatbot_Requirements.docx`

### Ticket List

| # | Title | Priority | Depends On |
|---|---|---|---|
| 01 | Foundation: Models, Types, Ports | P0 | — |
| 02 | Conversation Persistence + 7-Day TTL | P0 | 01 |
| 03 | Knowledge Store: Topic-Based CRUD | P0 | 01 |
| 04 | Chatbot Agent Runner: Read-Only Wrapper | P0 | 01 |
| 05 | Chatbot Service: Q&A Orchestration | P0 | 02, 03, 04 |
| 06 | API Routes: Chat Endpoints | P0 | 05 |
| 07 | DI Wiring: Host Port + Registration | P0 | 06 |
| 08 | ChatPanel UI: Rewrite with Persistence | P0 | 07 |
| 09 | Expanded/Resizable Chat Modal | P1 | 08 |
| 10 | Knowledge Approval Modal | P1 | 03, 08 |
| 11 | Knowledge Upload + Extraction | P1 | 03 |
| 12 | Knowledge Conflict Resolution | P1 | 10 |
| 13 | Source Citation System | P1 | 05 |
| 14 | Evidence Distinction Labels | P1 | 13 |
| 15 | File-Access Exclusions | P1 | 04 |
| 16 | Concurrent Implementation Awareness | P2 | 05 |
| 17 | Stop / Regenerate / Cancel Controls | P1 | 08 |
| 18 | Conversation History Browser | P1 | 02, 08 |
| 19 | Git History Integration | P2 | 05 |
| 20 | Integration Testing + E2E Scenarios | P1 | All P0 |
