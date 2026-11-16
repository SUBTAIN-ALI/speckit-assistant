'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send, Trash2 } from 'lucide-react';
import { MarkdownPreview } from './MarkdownPreview';
import { readSse } from '../lib/sse';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type Props = {
  active: boolean;
};

export const ChatPanel: React.FC<Props> = ({ active }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (active && !streaming) textareaRef.current?.focus();
  }, [active, streaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setError(null);

    const userMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setStreaming(true);

    const assistantMessage: Message = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    const apiMessages = updatedMessages.map(m => ({ role: m.role, content: m.content }));

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Chat request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      let accumulated = '';
      await readSse(res, (event, data) => {
        if (event === 'token' && data.text) {
          accumulated += data.text;
          const content = accumulated;
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content };
            return next;
          });
        } else if (event === 'error') {
          setError(data.message || 'An error occurred');
        }
      });

      if (!accumulated) {
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: 'No response received.' };
          return next;
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Failed to send message');
      setMessages(updatedMessages);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-600 text-sm">
            Ask anything about your project — requirements, specs, plans, architecture.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black'
                  : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <MarkdownPreview content={msg.content || (streaming && i === messages.length - 1 ? '...' : '')} />
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        {error && (
          <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your project..."
            disabled={streaming}
            rows={1}
            className="flex-1 resize-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 disabled:opacity-50"
            style={{ maxHeight: '120px' }}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="shrink-0 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-3 py-2 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-500 px-2 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
              title="Clear chat"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
