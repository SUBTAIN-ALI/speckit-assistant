# Ticket 19: Git History Integration

**Priority:** P2  
**Depends On:** Ticket 05  
**Requirements Ref:** Sections 3.3, AC-15  
**Estimated Effort:** Small  

## Description

Enable the chatbot agent to use Git history when answering questions about past changes, historical versions, or "when did X change?" queries. Git history is used ONLY when the question requires it — ordinary current-state questions do not trigger it.

Since the chatbot uses the AI CLI (which already has access to git commands), this ticket is primarily about:
1. Ensuring the agent prompt allows git CLI usage
2. Adding guidance on when git history is appropriate
3. Handling projects without git history gracefully

## Implementation

### Agent Prompt Addition (in `ChatbotAgentRunner`)

Add to the `READ_ONLY_SYSTEM_PROMPT`:

```
## Git History Usage
- You CAN run read-only git commands: git log, git show, git diff, git blame, git shortlog
- You MUST NOT run git commands that modify state: git commit, git push, git reset, git checkout
- Use git history ONLY when the question asks about:
  - Past changes ("when did this change?", "who changed this?", "what changed recently?")
  - Historical versions ("what did this look like before?")
  - Change frequency or patterns ("how often does this file change?")
- For ordinary "what does X do?" questions, inspect current files — do not dig through history.
- If the project has no git history, acknowledge it and answer from current files only.
```

### Non-Git Projects

If the project directory has no `.git/` folder:
- The agent should not attempt git commands
- If the user asks about history: "This project doesn't have git history. I can only answer based on the current project files."
- Detection: the `ChatbotAgentRunner` checks for `.git/` existence and includes a note in the prompt

```typescript
// In ChatbotAgentRunner.spawn():
const hasGit = fs.existsSync(path.join(workspacePath, '.git'));
const gitNote = hasGit
  ? '' // Git available, no extra note needed
  : '\n\nNote: This project has no git history. Do not attempt git commands. Answer from current files only.';
```

## Acceptance Criteria

- [ ] Agent can use git log, git show, git diff, git blame for historical questions
- [ ] Agent does not use git for ordinary current-state questions (AC-15)
- [ ] Agent cannot run state-modifying git commands
- [ ] Non-git projects handled gracefully with clear message
- [ ] Historical answers include commit references where applicable

## Test Cases

### `src/chatbot/adapters/__tests__/ChatbotAgentRunner.git.test.ts`

```typescript
describe('ChatbotAgentRunner - Git History', () => {
  // T19-1: Prompt allows read-only git commands
  it('prompt mentions git log, git show, git diff, git blame', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('git log');
    expect(prompt).toContain('git blame');
  });

  // T19-2: Prompt forbids state-modifying git commands
  it('prompt forbids git commit, push, reset', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('MUST NOT run git commands that modify');
  });

  // T19-3: Non-git project detection
  it('includes no-git note when .git/ does not exist', async () => {
    // Use a workspace path without .git/
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    // Mock fs.existsSync for .git check
    await runner.spawn('/no-git-project', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('no git history');
  });

  // T19-4: Git project has no extra note
  it('omits no-git note when .git/ exists', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    // Mock fs.existsSync for .git check to return true
    await runner.spawn('/git-project', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).not.toContain('no git history');
  });

  // T19-5: History guidance mentions when to use git
  it('prompt guides when to use git history', async () => {
    const host = mockHost();
    const runner = new ChatbotAgentRunner(host, mockKnowledgeStore());
    await runner.spawn('/test', 'question', '');
    const prompt = (host.spawnReadOnlyAgent as jest.Mock).mock.calls[0][1];
    expect(prompt).toContain('when did this change');
    expect(prompt).toContain('ordinary');
  });
});
```
