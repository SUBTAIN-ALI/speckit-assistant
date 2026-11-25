import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EPS_ENDPOINTS, EpsEnvironment, EpsError } from '../../../domain/models/eps';
import { EpsGatewayPort, EpsSecretsPort } from '../../../domain/ports/out/EpsPort';

export function epsToolPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') throw new EpsError('EPS returned an invalid tool result.', 'protocol');
  const result = value as { isError?: boolean; content?: unknown };
  const content = Array.isArray(result.content) ? result.content : [];
  if (result.isError) throw new EpsError('EPS rejected the tool request. Check its arguments and requirement availability.', 'tool');
  const text = content.filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n');
  try { return JSON.parse(text); } catch { throw new EpsError('EPS returned an invalid JSON tool result.', 'protocol'); }
}

export class EpsMcpGateway implements EpsGatewayPort {
  constructor(private secrets: EpsSecretsPort) {}
  private async session<T>(environment: EpsEnvironment, action: (client: Client) => Promise<T>): Promise<T> {
    const token = await this.secrets.get(environment);
    if (!token) throw new EpsError('Add an EPS token in the EPS connection settings.', 'auth');
    const client = new Client({ name: 'speckit-assistant-eps', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(EPS_ENDPOINTS[environment]), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport, { timeout: 20_000 });
      return await action(client);
    } catch (error) {
      if (error instanceof EpsError) throw error;
      if (error instanceof StreamableHTTPError && error.code === 401) {
        throw new EpsError('EPS token is invalid, expired, or revoked. Replace it in the connection settings.', 'auth');
      }
      if (typeof (error as { code?: unknown })?.code === 'number' && Number((error as { code: number }).code) < 0) {
        throw new EpsError('EPS rejected the MCP protocol request. Test the connection and verify server compatibility.', 'protocol');
      }
      // Never return raw SDK errors: remote responses may include sensitive headers.
      throw new EpsError('EPS request failed. Check the connection and try again.', 'transport');
    } finally { await client.close().catch(() => {}); }
  }
  call(environment: EpsEnvironment, tool: string, args: Record<string, unknown>) {
    return this.session(environment, async client => epsToolPayload(await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 20_000 })));
  }
  async test(environment: EpsEnvironment) {
    await this.session(environment, async client => {
      const { tools } = await client.listTools(undefined, { timeout: 20_000 });
      for (const name of ['list_released_requirements', 'get_requirement', 'get_messages', 'update_status', 'set_compliance', 'post_message']) {
        if (!tools.some(tool => tool.name === name)) throw new EpsError(`EPS is missing the required tool: ${name}`, 'protocol');
      }
    });
  }
}
