// A single MCP server definition, transport-agnostic. Translated into each
// CLI's native config format when applied (see mcpTranslate.ts).
export type McpTransport = 'stdio' | 'http' | 'sse';

export type McpServer = {
  id: string;
  name: string; // key used in the CLI's native config
  transport: McpTransport;
  command?: string; // stdio
  args?: string[]; // stdio
  env?: Record<string, string>; // stdio
  url?: string; // http | sse
  // http | sse request headers. Values may reference env vars as ${VAR}, which
  // the CLIs expand at runtime (e.g. Authorization: Bearer ${ZOOM_MEETINGS_MCP_ACCESS_TOKEN}).
  headers?: Record<string, string>;
  enabled: boolean;
  description?: string;
};

export type McpFile = {
  servers: McpServer[];
};

export const DEFAULT_MCP: McpFile = { servers: [] };

// Env var the agent runner fills with a fresh Zoom access token (from the Zoom
// sign-in in Requirements → Settings) for every agent run.
export const ZOOM_TOKEN_ENV = 'ZOOM_MEETINGS_MCP_ACCESS_TOKEN';

// Zoom's official Meetings MCP server, configured the way Zoom's own Claude
// plugin does it (zoom/zoom-plugin .mcp.json).
export const ZOOM_MCP_PRESET: McpServer = {
  id: 'zoom-meetings',
  name: 'zoom-meetings',
  transport: 'http',
  url: 'https://mcp.zoom.us/mcp/meeting/streamable',
  headers: { Authorization: `Bearer \${${ZOOM_TOKEN_ENV}}` },
  enabled: true,
  description: 'Zoom Meetings MCP (search, assets, recordings, transcripts). Token comes from the Zoom sign-in in Requirements → Settings.',
};

export function isZoomMcpServer(s: McpServer): boolean {
  try {
    return s.transport !== 'stdio' && !!s.url && /(^|\.)zoom\.us$/i.test(new URL(s.url).hostname);
  } catch {
    return false;
  }
}
