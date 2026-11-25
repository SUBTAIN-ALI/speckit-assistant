'use client';

import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './chat/CodeBlock';
import { GithubAlert, detectAlert } from './chat/GithubAlert';

const remarkPlugins = [remarkGfm];

const components: Components = {
  code: CodeBlock as Components['code'],

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-500 dark:text-blue-400 underline hover:text-blue-600 dark:hover:text-blue-300 break-all"
    >
      {children}
    </a>
  ),

  blockquote: ({ children }) => {
    const alert = detectAlert(children);
    if (alert) {
      return <GithubAlert type={alert.type}>{alert.rest}</GithubAlert>;
    }
    return (
      <blockquote className="border-l-4 border-zinc-200 dark:border-zinc-700 pl-3 my-2 text-zinc-600 dark:text-zinc-400">
        {children}
      </blockquote>
    );
  },

  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  ),

  thead: ({ children }) => (
    <thead className="bg-zinc-50 dark:bg-zinc-900">{children}</thead>
  ),

  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left text-xs font-semibold text-zinc-700 dark:text-zinc-300 border-b border-zinc-200 dark:border-zinc-700">
      {children}
    </th>
  ),

  td: ({ children }) => (
    <td className="px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300">
      {children}
    </td>
  ),

  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ''} className="max-w-full rounded-md my-2" loading="lazy" />
  ),

  hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-800" />,

  ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-zinc-800 dark:text-zinc-200">{children}</li>,
};

type Props = { content: string };

export const ChatMarkdownRenderer: React.FC<Props> = React.memo(({ content }) => (
  <div className="prose prose-sm dark:prose-invert max-w-none overflow-hidden break-words">
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {content}
    </ReactMarkdown>
  </div>
));

ChatMarkdownRenderer.displayName = 'ChatMarkdownRenderer';
