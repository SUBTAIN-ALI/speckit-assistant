'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Square, Trash2, Plus, ChevronDown, Maximize2, Minimize2, RefreshCw, Upload, AlertTriangle, Loader2 } from 'lucide-react';
import { ChatMarkdownRenderer } from '../../components/ChatMarkdownRenderer';
import { readSse } from '../../lib/sse';
import { parseCitations, stripCitations } from '../domain/CitationParser';
import { CitationView } from './CitationView';
import { ConversationList } from './ConversationList';
import { KnowledgeApprovalModal } from './KnowledgeApprovalModal';
import type { ChatMessage, ConversationSummary, ChatState, KnowledgeChange, CitationSource } from '../domain/models';

type Props = {
  active: boolean;
  expanded?: boolean;
  onExpandToggle?: () => void;
};

type MessageExt = ChatMessage & { superseded?: boolean };

const KNOWLEDGE_PROPOSAL_RE = /<!-- KNOWLEDGE_PROPOSAL:\s*(\{[\s\S]*?\})\s*-->/;

const EVIDENCE_MARKER_RE = /\[(Code Fact|Spec Intent|Review Outcome|General Knowledge|Uncertain)\]:?\s*/g;
const SYSTEM_PROMPT_NOISE_RE = /\*{0,2}(Code Fact|Spec Intent|Review Outcome|General Knowledge|Uncertain)\*{0,2}\s*\**:?\s*(?:What (?:the inspected source code actually does|specifications or requirements say should happen|review\/test reports found)|Industry conventions or common patterns(?: \(always labeled\))?|When evidence is incomplete[^.\n]*\.?)\s*/gi;

function stripAgentNoise(text: string): string {
  return text
    // Strip JSON control messages from agent APIs (OpenAI/Codex)
    .replace(/\{"(?:type|exit_code|status)":[^\n]*?"(?:turn\.completed|item\.completed|response\.completed|response\.done|completed)"[^\n]*?\}/g, '')
    // Strip usage/token JSON blocks
    .replace(/\{"(?:input_tokens|output_tokens|usage)":[^\n]*?\}/g, '')
    .replace(SYSTEM_PROMPT_NOISE_RE, '')
    .replace(EVIDENCE_MARKER_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return `${Math.floor(diff / 86400000)}d ago`;
}

function detectKnowledgeProposal(content: string): { slug: string; title: string; content: string } | null {
  const match = content.match(KNOWLEDGE_PROPOSAL_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export const ChatPanel: React.FC<Props> = ({ active, expanded, onExpandToggle }) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageExt[]>([]);
  const [input, setInput] = useState('');
  const [chatState, setChatState] = useState<ChatState>('ready');
  const [error, setError] = useState<string | null>(null);
  const [showConvList, setShowConvList] = useState(false);
  const [knowledgeChange, setKnowledgeChange] = useState<KnowledgeChange | null>(null);
  const [implRunning, setImplRunning] = useState(false);
  const [implFeature, setImplFeature] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const lastUserMsgRef = useRef<string>('');
  const activeTitle = conversations.find(c => c.id === activeId)?.title;

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chatbot/conversations');
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (active) loadConversations();
  }, [active, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (active && chatState === 'ready') textareaRef.current?.focus();
  }, [active, chatState]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/chatbot/status');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setImplRunning(data.implementationRunning ?? false);
          setImplFeature(data.activeFeature);
        }
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active]);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chatbot/conversations/${id}`);
      if (res.ok) {
        const conv = await res.json();
        setActiveId(id);
        setMessages(conv.messages || []);
        setShowConvList(false);
      }
    } catch { /* ignore */ }
  }, []);

  const startNewConversation = useCallback(() => {
    setActiveId(null);
    setMessages([]);
    setShowConvList(false);
    setError(null);
  }, []);

  const sendMessageText = useCallback(async (text: string) => {
    if (!text || chatState === 'investigating') return;

    setInput('');
    setError(null);
    setChatState('investigating');
    lastUserMsgRef.current = text;

    const userMsg: MessageExt = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      status: 'complete',
      createdAt: new Date().toISOString(),
    };
    const assistantMsg: MessageExt = {
      id: `temp-a-${Date.now()}`,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const controller = new AbortController();
      let res = await fetch('/api/chatbot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeId, message: text }),
        signal: controller.signal,
      });
      if (res.status === 503) {
        await new Promise(r => setTimeout(r, 1500));
        res = await fetch('/api/chatbot/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: activeId, message: text }),
          signal: controller.signal,
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const fallback = res.status === 503
          ? 'Service temporarily unavailable — the agent may still be starting. Please try again.'
          : `API error: ${res.status} ${res.statusText}`;
        throw new Error(err.error || fallback);
      }

      let newConvId = activeId;
      let accumulated = '';

      stopRef.current = () => {
        controller.abort();
        if (newConvId) {
          fetch(`/api/chatbot/conversations/${newConvId}/stop`, { method: 'POST' }).catch(() => {});
        }
      };

      await readSse(res, (event, data) => {
        if (event === 'meta') {
          newConvId = data.conversationId;
          setActiveId(data.conversationId);
        } else if (event === 'token' && data.text) {
          accumulated += data.text;
          const content = accumulated;
          const citations = parseCitations(content);
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], content, citations };
            return next;
          });
        } else if (event === 'done') {
          const citations = parseCitations(accumulated);
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], status: 'complete', citations };
            return next;
          });

          const proposal = detectKnowledgeProposal(accumulated);
          if (proposal) {
            fetch('/api/chatbot/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'prepare', ...proposal }),
            })
              .then(r => r.json())
              .then((change: KnowledgeChange) => setKnowledgeChange(change))
              .catch(() => {});
          }
        } else if (event === 'error') {
          setError(data.message || 'An error occurred');
        }
      });

      if (!accumulated) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], content: 'No response received.', status: 'complete' };
          return next;
        });
      }

      loadConversations();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages(prev => {
          const next = [...prev];
          if (next.length > 0) {
            next[next.length - 1] = { ...next[next.length - 1], status: 'canceled' };
          }
          return next;
        });
      } else {
        setError(err.message || 'Failed to send message');
        setMessages(prev => prev.slice(0, -1));
      }
    } finally {
      setChatState('ready');
      stopRef.current = null;
    }
  }, [chatState, activeId, loadConversations]);

  const sendMessage = useCallback(() => {
    sendMessageText(input.trim());
  }, [input, sendMessageText]);

  const handleStop = useCallback(() => {
    if (stopRef.current) stopRef.current();
  }, []);

  const handleRegenerate = useCallback(async () => {
    const lastUser = lastUserMsgRef.current;
    if (!lastUser || chatState === 'investigating') return;
    if (activeId) {
      await fetch(`/api/chatbot/conversations/${activeId}/stop`, { method: 'POST' }).catch(() => {});
    }
    setMessages(prev => {
      const next = [...prev];
      if (next.length > 0 && next[next.length - 1].role === 'assistant') {
        next[next.length - 1] = { ...next[next.length - 1], superseded: true };
      }
      return next;
    });
    sendMessageText(lastUser);
  }, [chatState, activeId, sendMessageText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'Escape') {
      if (chatState === 'investigating') {
        handleStop();
      } else if (messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last.role === 'assistant' && !last.content && last.status === 'streaming') {
          setMessages(prev => prev.slice(0, -1));
        }
      }
    }
  };

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/chatbot/conversations/${id}`, { method: 'DELETE' });
      if (activeId === id) startNewConversation();
      loadConversations();
    } catch { /* ignore */ }
  }, [activeId, startNewConversation, loadConversations]);

  const handleKnowledgeApprove = useCallback(async () => {
    if (!knowledgeChange) return;
    try {
      await fetch('/api/chatbot/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', slug: knowledgeChange.slug, title: knowledgeChange.title, content: knowledgeChange.proposedContent }),
      });
    } catch { /* ignore */ }
    setKnowledgeChange(null);
  }, [knowledgeChange]);

  const handleKnowledgeMerge = useCallback(async () => {
    if (!knowledgeChange || !knowledgeChange.previousContent) return;
    const merged = knowledgeChange.previousContent + '\n\n' + knowledgeChange.proposedContent;
    try {
      await fetch('/api/chatbot/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', slug: knowledgeChange.slug, title: knowledgeChange.title, content: merged }),
      });
    } catch { /* ignore */ }
    setKnowledgeChange(null);
  }, [knowledgeChange]);

  const handleFileUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.md,.txt,.markdown,.text';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      setError(null);
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/chatbot/knowledge/upload', { method: 'POST', body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Upload failed' }));
          setError(err.error || 'Upload failed');
          return;
        }
        const { text, filename } = await res.json();
        sendMessageText(`I've uploaded a document "${filename}". Here is its extracted content. Please organize this into knowledge topics and suggest them for saving:\n\n${text.slice(0, 8000)}`);
      } catch (err: any) {
        setError(err.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }, [sendMessageText]);

  if (!active) return null;

  const lastAssistantIdx = messages.reduce((acc, m, i) => m.role === 'assistant' && m.status === 'complete' && !m.superseded ? i : acc, -1);

  const renderMessage = (msg: MessageExt, i: number) => {
    const citations = msg.citations || parseCitations(msg.content);
    const displayContent = msg.role === 'assistant' ? stripAgentNoise(stripCitations(msg.content)) : msg.content;

    return (
      <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${msg.superseded ? 'opacity-40' : ''}`}>
        <div
          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm overflow-hidden ${
            msg.role === 'user'
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black'
              : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
          } ${msg.status === 'canceled' ? 'opacity-60' : ''} ${msg.status === 'error' ? 'border border-red-300 dark:border-red-700' : ''}`}
        >
          {msg.role === 'assistant' ? (
            <div>
              <ChatMarkdownRenderer content={displayContent || (msg.status === 'streaming' ? '...' : '')} />
              {msg.status === 'streaming' && (
                <span className="inline-block w-1.5 h-4 bg-zinc-400 dark:bg-zinc-500 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
              )}
              {citations.length > 0 && msg.status === 'complete' && <CitationView citations={citations} />}
            </div>
          ) : (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          )}
          {msg.status === 'canceled' && (
            <div className="text-xs text-zinc-400 mt-1 italic">Response interrupted</div>
          )}
          {msg.superseded && (
            <div className="text-xs text-zinc-400 mt-1 italic">Regenerated</div>
          )}
          {msg.status === 'error' && (
            <div className="text-xs text-red-400 mt-1">Error generating response</div>
          )}
          {/* Regenerate button on last complete assistant message */}
          {i === lastAssistantIdx && chatState === 'ready' && !msg.superseded && (
            <button
              onClick={handleRegenerate}
              className="mt-1.5 flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
            >
              <RefreshCw size={11} /> Regenerate
            </button>
          )}
        </div>
      </div>
    );
  };

  const mainContent = (
    <>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <div className="relative flex-1 min-w-0">
          {!expanded ? (
            <>
              <button
                onClick={() => setShowConvList(prev => !prev)}
                className="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition max-w-full overflow-hidden"
              >
                <span className="truncate">{activeTitle || 'New Conversation'}</span>
                <ChevronDown size={14} className="shrink-0" />
              </button>
              {showConvList && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  <button
                    onClick={startNewConversation}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                  >
                    <Plus size={14} /> New conversation
                  </button>
                  {conversations.length > 0 && <div className="border-t border-zinc-100 dark:border-zinc-800" />}
                  {conversations.map(c => (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition ${
                        c.id === activeId
                          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <span className="flex-1 truncate" onClick={() => loadConversation(c.id)}>
                        {c.title || 'Untitled'}
                      </span>
                      <span className="text-xs text-zinc-400 shrink-0">{relativeTime(c.updatedAt)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                        className="p-0.5 text-zinc-400 hover:text-red-500 transition"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
              {activeTitle || 'New Conversation'}
            </span>
          )}
        </div>

        <button
          onClick={handleFileUpload}
          disabled={uploading}
          className="shrink-0 p-1.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
          title="Upload document"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        </button>
        <button
          onClick={startNewConversation}
          className="shrink-0 p-1.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          title="New conversation"
        >
          <Plus size={16} />
        </button>
        {onExpandToggle && (
          <button
            onClick={onExpandToggle}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-600 text-sm gap-3">
            <p>Ask anything about your project</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-xs">
              {['How does auth work?', 'What business rules exist?', 'Explain the data flow'].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); textareaRef.current?.focus(); }}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(renderMessage)}
        {error && (
          <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload Progress */}
      {uploading && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-t border-blue-200 dark:border-blue-800">
          <Loader2 size={14} className="text-blue-600 dark:text-blue-400 shrink-0 animate-spin" />
          <span className="text-xs text-blue-700 dark:text-blue-300">Uploading and extracting document...</span>
        </div>
      )}

      {/* Implementation Warning */}
      {implRunning && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-800">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-xs text-amber-700 dark:text-amber-300">
            An implementation is running{implFeature ? ` (${implFeature})` : ''}. Answers about affected files may be outdated.
          </span>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your project..."
            disabled={chatState === 'investigating'}
            rows={1}
            className="flex-1 resize-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50"
            style={{ maxHeight: '120px' }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          {chatState === 'investigating' ? (
            <button
              onClick={handleStop}
              className="shrink-0 rounded-md bg-red-600 text-white px-3 py-2 text-sm font-medium hover:bg-red-700 transition"
              title="Stop (Esc)"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="shrink-0 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-3 py-2 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className={`flex-1 min-h-0 flex ${expanded ? 'flex-row' : 'flex-col'} overflow-hidden bg-white dark:bg-black`}>
        {expanded && (
          <div className="w-[250px] shrink-0">
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              onSelect={loadConversation}
              onNew={startNewConversation}
              onDelete={handleDelete}
            />
          </div>
        )}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {mainContent}
        </div>
      </div>

      {knowledgeChange && (
        <KnowledgeApprovalModal
          change={knowledgeChange}
          open={!!knowledgeChange}
          onApprove={handleKnowledgeApprove}
          onReject={() => setKnowledgeChange(null)}
          onMerge={knowledgeChange.isConflict ? handleKnowledgeMerge : undefined}
        />
      )}
    </>
  );
};

export default ChatPanel;
