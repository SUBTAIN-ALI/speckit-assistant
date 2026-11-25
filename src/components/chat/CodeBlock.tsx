'use client';

import React, { useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CopyButton } from './CopyButton';

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript', json: 'json', css: 'css',
  scss: 'scss', html: 'markup', xml: 'markup', svg: 'markup',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', c: 'c', cpp: 'cpp', sql: 'sql',
  toml: 'toml', dockerfile: 'docker', diff: 'diff',
};

function useDarkMode(): boolean {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const el = document.documentElement;
    setDark(el.classList.contains('dark'));
    const obs = new MutationObserver(() => setDark(el.classList.contains('dark')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

type CodeBlockProps = {
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ className, children, ...rest }) => {
  const dark = useDarkMode();

  const match = className?.match(/language-(\w+)/);
  const rawLang = match?.[1] ?? '';
  const language = LANG_ALIASES[rawLang] ?? rawLang;
  const isInline = !match && !('node' in rest && rest.node && typeof rest.node === 'object' && 'tagName' in (rest.node as Record<string, unknown>) && (rest.node as Record<string, unknown>).tagName === 'code' && 'position' in (rest.node as Record<string, unknown>));

  const code = useMemo(() => {
    const raw = String(children ?? '');
    return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  }, [children]);

  if (isInline || !className) {
    return (
      <code className="px-1 py-0.5 rounded text-[0.85em] bg-zinc-100 dark:bg-zinc-800 text-red-500 dark:text-red-400 font-mono">
        {children}
      </code>
    );
  }

  const displayLang = rawLang || 'text';

  return (
    <div className="not-prose my-3 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">{displayLang}</span>
        <CopyButton text={code} />
      </div>
      <SyntaxHighlighter
        style={dark ? oneDark : oneLight}
        language={language || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8125rem', lineHeight: '1.5' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};
