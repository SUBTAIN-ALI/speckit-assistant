import { AgentType } from '../models/types';

// Per-million-token prices in USD. These are ESTIMATES used only to approximate
// run cost when a CLI does not print its own usage/cost. Keep them easy to edit;
// they are intentionally coarse and may drift from provider pricing over time.
export type ModelPrice = { inputPerM: number; outputPerM: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic Claude
  'claude-opus': { inputPerM: 15, outputPerM: 75 },
  'claude-sonnet': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku': { inputPerM: 0.8, outputPerM: 4 },
  // OpenAI — GPT-6 family
  'gpt-6-astra': { inputPerM: 10, outputPerM: 50 },
  'gpt-6-sol': { inputPerM: 2, outputPerM: 10 },
  'gpt-6-luna': { inputPerM: 0.10, outputPerM: 0.50 },
  'gpt-6.1-sol': { inputPerM: 2, outputPerM: 10 },
  'gpt-6.2-astra': { inputPerM: 10, outputPerM: 50 },
  'gpt-6.2-sol': { inputPerM: 2, outputPerM: 10 },
  // OpenAI — GPT-5 / legacy
  'gpt-5.5': { inputPerM: 5, outputPerM: 30 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4.1': { inputPerM: 2, outputPerM: 8 },
  'o-series': { inputPerM: 15, outputPerM: 60 },
  // Google Gemini
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
};

// Fallback when the model can't be matched to the table above.
export const DEFAULT_PRICE: ModelPrice = { inputPerM: 3, outputPerM: 15 };

// Assumed model per agent CLI when AgentConfig.model / persona.model is absent.
export const AGENT_DEFAULT_MODEL: Record<AgentType, string> = {
  claude: 'claude-sonnet',
  gemini: 'gemini-2.5-flash',
  copilot: 'gpt-4o',
  openai: 'gpt-6-sol',
  custom: 'default',
};

// Normalize an arbitrary model string to a MODEL_PRICES key by substring match.
export function normalizeModel(model?: string): string | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'claude-opus';
  if (m.includes('sonnet')) return 'claude-sonnet';
  if (m.includes('haiku')) return 'claude-haiku';
  // GPT-6 family (check specific variants before broad matches)
  if (m.includes('6.2-astra') || m.includes('6.2 astra')) return 'gpt-6.2-astra';
  if (m.includes('6.2-sol') || m.includes('6.2 sol')) return 'gpt-6.2-sol';
  if (m.includes('6.1-sol') || m.includes('6.1 sol')) return 'gpt-6.1-sol';
  if (m.includes('6-astra') || m.includes('6 astra') || m.includes('gpt-6-astra')) return 'gpt-6-astra';
  if (m.includes('6-luna') || m.includes('6 luna') || m.includes('gpt-6-luna')) return 'gpt-6-luna';
  if (m.includes('6-sol') || m.includes('6 sol') || m.includes('gpt-6-sol')) return 'gpt-6-sol';
  // GPT-5
  if (m.includes('gpt-5.5') || m.includes('5.5')) return 'gpt-5.5';
  // GPT-4 / legacy
  if (m.includes('gpt-4o-mini') || m.includes('4o-mini')) return 'gpt-4o-mini';
  if (m.includes('gpt-4o') || m.includes('4o')) return 'gpt-4o';
  if (m.includes('gpt-4.1') || m.includes('4.1')) return 'gpt-4.1';
  if (/\bo[134]\b/.test(m) || m.includes('o-series') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'o-series';
  if (m.includes('gemini') && m.includes('pro')) return 'gemini-2.5-pro';
  if (m.includes('gemini')) return 'gemini-2.5-flash';
  // Direct table hit (exact key).
  if (MODEL_PRICES[m]) return m;
  return undefined;
}

export function priceFor(model?: string): ModelPrice {
  const key = normalizeModel(model);
  return (key && MODEL_PRICES[key]) || DEFAULT_PRICE;
}
