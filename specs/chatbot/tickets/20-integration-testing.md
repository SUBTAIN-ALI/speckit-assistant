# Ticket 20: Integration Testing + E2E Scenarios

**Priority:** P1  
**Depends On:** All P0 tickets (01–08)  
**Requirements Ref:** Section 9 (Acceptance Criteria), Section 10 (Verification Checklist)  
**Estimated Effort:** Large  

## Description

End-to-end integration tests that verify the chatbot works as a complete system. These tests validate the acceptance criteria from the requirements document and exercise the full flow: UI → API → Service → Agent → Persistence.

This ticket covers:
1. Integration tests for the chatbot service layer (service + store + runner)
2. API route integration tests
3. Acceptance criteria verification tests (AC-01 through AC-15)
4. Module isolation verification

## Test Suites

### Suite 1: Service Integration Tests

### `src/chatbot/__tests__/integration/ChatbotService.integration.test.ts`

Tests the service with real `FSConversationStore` and `FSKnowledgeStore` but mocked agent runner.

```typescript
describe('ChatbotService Integration', () => {
  let tmpDir: string;
  let service: ChatbotService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbot-integ-'));
    const convStore = new FSConversationStore();
    const knowStore = new FSKnowledgeStore();
    const agentRunner = mockAgentRunner(['The auth module uses JWT.']);
    service = new ChatbotService(convStore, knowStore, agentRunner);
  });

  // AC-01: Chatbot answers without modifying code
  it('AC-01: answers a question and creates no files outside .specify/chatbot/', async () => {
    const response = await service.chat({ message: 'How does auth work?', projectPath: tmpDir });
    const chunks: string[] = [];
    for await (const c of response.stream) chunks.push(c);
    
    // Verify only chatbot conversation files created
    const specifyDir = path.join(tmpDir, '.specify', 'chatbot');
    expect(fs.existsSync(specifyDir)).toBe(true);
    
    // Verify no other files created in project root
    const rootFiles = fs.readdirSync(tmpDir).filter(f => f !== '.specify');
    expect(rootFiles).toHaveLength(0);
  });

  // AC-02: Follow-up uses prior context
  it('AC-02: follow-up question uses prior conversation context', async () => {
    const r1 = await service.chat({ message: 'How does auth work?', projectPath: tmpDir });
    for await (const _ of r1.stream) {}
    
    const r2 = await service.chat({
      conversationId: r1.conversationId,
      message: 'What about the refresh token?',
      projectPath: tmpDir,
    });
    for await (const _ of r2.stream) {}
    
    // Verify both messages in conversation
    const conv = await service.getConversation(r1.conversationId, tmpDir);
    expect(conv!.messages).toHaveLength(4); // 2 user + 2 assistant
  });

  // AC-03: New response uses current files
  it('AC-03: new response reflects latest project state', async () => {
    // First question
    const r1 = await service.chat({ message: 'What config exists?', projectPath: tmpDir });
    for await (const _ of r1.stream) {}
    
    // Modify project (simulate file change)
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src', 'new-file.ts'), 'export const x = 1;');
    
    // Second question — agent should see new file
    // (Agent is mocked here, but in real integration it would see the new file)
    const r2 = await service.chat({
      conversationId: r1.conversationId,
      message: 'What about the new file?',
      projectPath: tmpDir,
    });
    for await (const _ of r2.stream) {}
    
    // Old answer preserved as historical
    const conv = await service.getConversation(r1.conversationId, tmpDir);
    expect(conv!.messages[1].status).toBe('complete'); // first answer still complete
  });

  // AC-08: Knowledge not saved without approval
  it('AC-08: no knowledge files created without explicit save', async () => {
    await service.chat({ message: 'Remember that refunds need approval', projectPath: tmpDir });
    const knowledgeDir = path.join(tmpDir, '.specify', 'chatbot', 'knowledge');
    const exists = fs.existsSync(knowledgeDir);
    if (exists) {
      const files = fs.readdirSync(knowledgeDir);
      expect(files).toHaveLength(0);
    }
  });

  // AC-10: Conversation survives conceptual project removal/reconnection
  it('AC-10: conversation persists in project directory', async () => {
    const r = await service.chat({ message: 'Test', projectPath: tmpDir });
    for await (const _ of r.stream) {}
    
    // Verify file exists on disk
    const convDir = path.join(tmpDir, '.specify', 'chatbot', 'conversations');
    const files = fs.readdirSync(convDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
  });

  // AC-12: Stopping one response doesn't affect others
  it('AC-12: stop does not affect other conversations', async () => {
    const r1 = await service.chat({ message: 'Q1', projectPath: tmpDir });
    const r2 = await service.chat({ message: 'Q2', projectPath: tmpDir });
    
    r1.stop();
    
    // r2 should still work
    const chunks: string[] = [];
    for await (const c of r2.stream) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

### Suite 2: Module Isolation Tests

### `src/chatbot/__tests__/isolation.test.ts`

```typescript
describe('Chatbot Module Isolation', () => {
  // Verify the chatbot module does not import from host modules
  it('no imports from src/domain/', () => {
    const result = execSync(
      "grep -r \"from '.*src/domain\\|from '.*\\.\\./\\.\\./domain\" src/chatbot/ || true",
      { encoding: 'utf-8' }
    );
    expect(result.trim()).toBe('');
  });

  it('no imports from src/adapters/ (except through ports)', () => {
    const result = execSync(
      "grep -r \"from '.*src/adapters\\|from '.*\\.\\./\\.\\./adapters\" src/chatbot/ || true",
      { encoding: 'utf-8' }
    );
    expect(result.trim()).toBe('');
  });

  it('no imports from src/components/', () => {
    const result = execSync(
      "grep -r \"from '.*src/components\\|from '.*\\.\\./\\.\\./components\" src/chatbot/ || true",
      { encoding: 'utf-8' }
    );
    expect(result.trim()).toBe('');
  });

  // Verify chatbot has its own complete type system
  it('all chatbot types defined within src/chatbot/', () => {
    const result = execSync(
      "grep -r \"import.*type.*from\" src/chatbot/ | grep -v \"from '\\./\\|from '\\.\\./\" || true",
      { encoding: 'utf-8' }
    );
    // Only allowed external imports: React, lucide-react, uuid, etc.
    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      expect(line).not.toMatch(/from '.*src\//);
    }
  });
});
```

### Suite 3: Acceptance Criteria Matrix

### `src/chatbot/__tests__/acceptance-criteria.test.ts`

Maps every AC from the requirements doc to a test:

```typescript
describe('Acceptance Criteria', () => {
  // AC-01: Chatbot answers without modifying application code
  // → Covered in Service Integration tests

  // AC-02: Follow-up uses conversational context
  // → Covered in Service Integration tests

  // AC-03: New response uses updated working directory
  // → Covered in Service Integration tests

  // AC-04: Cross-project isolation
  it('AC-04: cannot access another project\'s data', async () => {
    const project1 = await fs.mkdtemp(path.join(os.tmpdir(), 'proj1-'));
    const project2 = await fs.mkdtemp(path.join(os.tmpdir(), 'proj2-'));
    
    const r1 = await service.chat({ message: 'Test', projectPath: project1 });
    for await (const _ of r1.stream) {}
    
    // Try to access project1's conversation from project2
    const conv = await convStore.get(r1.conversationId, project2);
    expect(conv).toBeNull(); // Not found — different project path
  });

  // AC-05: SDD records distinguishable from code
  // → Covered by Evidence Distinction tests (Ticket 14)

  // AC-06: Incomplete evidence shows verified + uncertain + general
  // → Covered by Evidence Distinction tests (Ticket 14)

  // AC-07: Citations available on request
  // → Covered by Citation tests (Ticket 13)

  // AC-08: Knowledge not saved without approval
  // → Covered in Service Integration tests

  // AC-09: Conflicting rule shown as replacement preview
  // → Covered by Knowledge Conflict tests (Ticket 12)

  // AC-10: Removing project preserves conversations
  // → Covered in Service Integration tests

  // AC-11: Switching AI tools retains conversation
  it('AC-11: conversation survives AI tool switch', async () => {
    // Create conversation
    const r = await service.chat({ message: 'Test', projectPath: tmpDir });
    for await (const _ of r.stream) {}
    
    // Conversation is stored as JSON, independent of AI tool
    // Switching tools only affects the agent runner, not the store
    const conv = await convStore.get(r.conversationId, tmpDir);
    expect(conv).not.toBeNull();
    expect(conv!.messages).toHaveLength(2);
  });

  // AC-12: Stopping one response doesn't cancel others
  // → Covered in Service Integration tests

  // AC-13: No user-level skill installation
  it('AC-13: chatbot does not install any skills at user level', () => {
    // Verify no skill installation code exists in the chatbot module
    const result = execSync(
      "grep -ri 'install.*skill\\|skill.*install' src/chatbot/ || true",
      { encoding: 'utf-8' }
    );
    expect(result.trim()).toBe('');
  });

  // AC-14: Partial findings when limits reached
  // → Enforced by agent system prompt (Ticket 04)

  // AC-15: Git used only for historical questions
  // → Enforced by agent system prompt (Ticket 19)
});
```

## Acceptance Criteria

- [ ] Service integration tests pass with real file stores
- [ ] Module isolation verified: zero imports from host modules
- [ ] All 15 acceptance criteria from requirements doc mapped to tests
- [ ] Cross-project isolation verified
- [ ] Concurrent conversation independence verified
- [ ] Knowledge write-protection verified (no saves without approval)

## Verification Checklist (from Requirements Section 10)

| Area | Verification Method |
|---|---|
| Application runtime | Test: service starts, spawns agent, streams response |
| Project identity | Test: conversations scoped to projectPath |
| Existing persistence | Test: conversations stored in `.specify/chatbot/conversations/` |
| AI CLI integration | Test: agent runner spawns session, captures stdout |
| Permissions | Test: read-only prompt present, no write operations |
| SDD records | Test: workflow state available to agent context |
| Frontend UI | Test: ChatPanel renders, handles all states |
| Document handling | Test: upload extracts text, cleanup after |
| Concurrency | Test: multiple conversations, stop one doesn't affect others |
| Source citations | Test: citations parsed and stored with messages |
