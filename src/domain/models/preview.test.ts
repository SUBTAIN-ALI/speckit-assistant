import { describe, it, expect } from 'vitest';
import { findServerUrl, parsePreviewConfig } from './preview';

describe('parsePreviewConfig', () => {
  it('keeps the useful fields and normalizes them', () => {
    expect(parsePreviewConfig(JSON.stringify({ command: ' pnpm dev ', cwd: './apps/web', port: 5173, path: 'signup', notes: ' ok ', extra: 1 })))
      .toEqual({ ok: true, value: { command: 'pnpm dev', cwd: 'apps/web', port: 5173, path: '/signup', notes: 'ok' } });
    expect(parsePreviewConfig(JSON.stringify({ command: 'npm start', port: 'abc', cwd: '' })))
      .toEqual({ ok: true, value: { command: 'npm start' } });
  });

  it('rejects a missing command, bad JSON and folders outside the project', () => {
    expect(parsePreviewConfig('{}').ok).toBe(false);
    expect(parsePreviewConfig('not json').ok).toBe(false);
    expect(parsePreviewConfig(JSON.stringify({ command: 'x', cwd: '../other' })).ok).toBe(false);
    expect(parsePreviewConfig(JSON.stringify({ command: 'x', cwd: '/etc' })).ok).toBe(false);
  });
});

describe('findServerUrl', () => {
  it.each([
    ['  ➜  Local:   http://localhost:5173/', 'http://localhost:5173'],
    ['   - Local:        http://localhost:3001', 'http://localhost:3001'],
    ['ready - started server on 0.0.0.0:3000, url: http://0.0.0.0:3000', 'http://localhost:3000'],
    ['Starting development server at http://127.0.0.1:8000/', 'http://127.0.0.1:8000'],
    ['\u001b[32mLocal:\u001b[39m \u001b[36mhttp://localhost:\u001b[1m4321\u001b[22m/\u001b[39m', 'http://localhost:4321'],
    ['Listening on http://[::]:8080', 'http://localhost:8080'],
  ])('%s', (line, url) => expect(findServerUrl(line)).toBe(url));

  it('ignores other addresses', () => {
    expect(findServerUrl('Docs: https://nextjs.org/docs')).toBeNull();
    expect(findServerUrl('compiling…')).toBeNull();
  });
});
