import axios from 'axios';
import { config } from '../config';
import type { ProviderUsage } from './aiUsageService';
import { discoveryCostMicros } from './noteDiscoveryBudgetService';

const endpoint = 'https://api.deepseek.com/chat/completions';
// These models support the documented non-streaming JSON-object protocol with thinking disabled.
const compatibleModels = new Set(['deepseek-flash', 'deepseek-v4-pro']);

export interface DiscoveryMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ProviderBody {
  model: string;
  messages: readonly DiscoveryMessage[];
  thinking: { type: 'disabled' };
  response_format: { type: 'json_object' };
  stream: false;
  max_tokens: number;
}

type KnownUsage = { [Key in keyof ProviderUsage]: number };
type ProviderResult =
  | { delivery: 'not_sent' | 'delivery_unknown' }
  | {
    delivery: 'response_received';
    usage: KnownUsage | null;
    response: 'ok' | 'retryable_error' | 'error' | 'length';
    content?: string;
  };

export type DiscoveryProviderTransport = (request: {
  url: typeof endpoint;
  headers: { Authorization: string };
  body: ProviderBody;
  signal: AbortSignal;
}) => Promise<{ status: number; data: unknown }>;

interface Prices {
  key: string | undefined;
  model: string;
  pricedModel: string | undefined;
  inputCnyPerMillion: number | string | undefined;
  outputCnyPerMillion: number | string | undefined;
}

const transportOnce: DiscoveryProviderTransport = async ({ url, body, headers, signal }) => {
  // Use the basic HTTP adapter, with no interceptors, redirects or automatic retry.
  return axios.post<unknown>(url, body, {
    adapter: 'http', maxRedirects: 0, proxy: false, signal, headers,
    responseType: 'json', maxContentLength: 256 * 1024, validateStatus: () => true,
  });
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseUsage(value: unknown): KnownUsage | null {
  const { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTokens } = object(value) ?? {};
  if (!tokenCount(inputTokens) || !tokenCount(outputTokens) || !tokenCount(totalTokens)
    || totalTokens !== inputTokens + outputTokens) return null;
  return { inputTokens, outputTokens, totalTokens };
}

export function createDiscoveryProvider(prices: Prices, transport = transportOnce) {
  const { model, key, inputCnyPerMillion, outputCnyPerMillion } = prices;
  if (!compatibleModels.has(model) || prices.pricedModel !== model || !key?.trim()
    || /\s/.test(key) || discoveryCostMicros(inputCnyPerMillion, outputCnyPerMillion, 1, 1) === null) return null;

  return {
    model, inputCnyPerMillion, outputCnyPerMillion,
    prepare(messages: readonly DiscoveryMessage[], maxOutputTokens: number) {
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4000) {
        throw new Error('invalid_discovery_output_limit');
      }
      const body: ProviderBody = {
        model, messages: messages.map(message => ({ ...message })), thinking: { type: 'disabled' },
        response_format: { type: 'json_object' }, stream: false, max_tokens: maxOutputTokens,
      };
      // Both supported models use byte-level BPE without expanding normalization.
      // Count every UTF-8 byte in the escaped request/history, plus independent
      // headroom for the hosted protocol's per-message and whole-request framing.
      const maxInputTokens = Buffer.byteLength(JSON.stringify(body), 'utf8') + 256 + body.messages.length * 32;
      return {
        maxInputTokens,
        async send(signal: AbortSignal): Promise<ProviderResult> {
          if (signal.aborted) return { delivery: 'not_sent' };
          let received: Awaited<ReturnType<DiscoveryProviderTransport>>;
          try {
            received = await transport({ url: endpoint, headers: { Authorization: `Bearer ${key}` }, body, signal });
          } catch {
            // No transport exception certifies that the remote server did not receive the request.
            return { delivery: 'delivery_unknown' };
          }
          const envelope = object(received.data);
          const usage = parseUsage(envelope?.usage);
          const { status } = received;
          if (status !== 200) {
            const response = [429, 500, 502, 503, 504].includes(status) ? 'retryable_error' : 'error';
            return { delivery: 'response_received', usage, response };
          }
          const choices = envelope?.choices;
          const choice = Array.isArray(choices) && choices.length === 1 ? object(choices[0]) : undefined;
          const content = object(choice?.message)?.content;
          if (choice?.finish_reason === 'length') return { delivery: 'response_received', usage, response: 'length' };
          if (choice?.finish_reason !== 'stop' || typeof content !== 'string' || !content.trim()) {
            return { delivery: 'response_received', usage, response: 'error' };
          }
          return { delivery: 'response_received', usage, response: 'ok', content };
        },
      };
    },
  };
}

export type DiscoveryProvider = NonNullable<ReturnType<typeof createDiscoveryProvider>>;

export const noteDiscoveryProvider = createDiscoveryProvider({
  key: config.DEEPSEEK_API_KEY,
  model: config.NOTE_DISCOVERY_MODEL,
  pricedModel: config.NOTE_DISCOVERY_PRICED_MODEL,
  inputCnyPerMillion: config.NOTE_DISCOVERY_MODEL_INPUT_CNY_PER_MILLION,
  outputCnyPerMillion: config.NOTE_DISCOVERY_MODEL_OUTPUT_CNY_PER_MILLION,
});
