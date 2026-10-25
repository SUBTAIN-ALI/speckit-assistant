import { NextResponse } from 'next/server';
import { integrationsService } from '../../../../adapters/di';
import { isLlmProvider } from '../../../../domain/models/credentials';
import { NotConfiguredError } from '../../../../domain/services/IntegrationsService';
import { LlmError } from '../../../../domain/ports/out/LlmPort';

// Lists a provider's models. Doubles as an API-key check from the settings form:
// the key may be one typed in but not saved yet.
export async function POST(req: Request) {
  try {
    const { provider, apiKey } = await req.json();
    if (!isLlmProvider(provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    const models = await integrationsService.listModels(provider, typeof apiKey === 'string' ? apiKey : undefined);
    return NextResponse.json({ models });
  } catch (err: any) {
    if (err instanceof NotConfiguredError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof LlmError) {
      const status = err.kind === 'auth' ? 401 : err.kind === 'rate_limit' ? 429 : 502;
      const message = err.kind === 'auth' ? 'The provider rejected this API key.' : err.message;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
