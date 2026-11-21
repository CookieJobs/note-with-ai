import axios from 'axios';
import { config } from '../config';
import type { ProviderUsage } from './aiUsageService';
import { discoveryCostMicros } from './noteDiscoveryBudgetService';
import type { NoteDiscoveryTool } from './noteDiscoveryTools';

const endpoint = 'https://api.deepseek.com/chat/completions';
// These models support the documented non-streaming JSON-object protocol with thinking disabled.
const compatibleModels = new Set(['deepseek-flash', 'deepseek-v4-pro']);

interface FunctionCall {
  type: 'function';
  id: string;
  function: { name: string; arguments: string };
}

type FunctionCallMessage = { role: 'assistant'; content: string | null; tool_calls: FunctionCall[] };
export type DiscoveryMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | FunctionCallMessage
  | { role: 'tool'; content: string; tool_call_id: string };

export interface DiscoveryToolOptions {
  tools: readonly NoteDiscoveryTool[];
  toolChoice: 'auto' | 'none';
}

interface ProviderBody {
  model: string;
  messages: readonly DiscoveryMessage[];
  thinking: { type: 'disabled' };
  response_format: { type: 'json_object' };
  stream: false;
  max_tokens: number;
  tools?: Array<{ type: 'function'; function: NoteDiscoveryTool }>;
  tool_choice?: 'auto' | 'none';
}

type KnownUsage = { [Key in keyof ProviderUsage]: number };
type ProviderResult =
  | { delivery: 'not_sent' | 'delivery_unknown' }
  | ({ delivery: 'response_received'; usage: KnownUsage | null } & (
    | { response: 'ok'; content: string }
    | { response: 'tools'; message: FunctionCallMessage; arguments: Record<string, unknown>[] }
    | { response: 'retryable_error' | 'error' | 'length' }
  ));

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

function transcriptCallIds(messages: readonly DiscoveryMessage[], allowedNames: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'tool') throw new Error('unpaired_discovery_tool_result');
    if (!('tool_calls' in message)) continue;
    for (const call of message.tool_calls) {
      const result = messages[++index];
      if (!allowedNames.has(call.function.name) || ids.has(call.id) || result?.role !== 'tool' || result.tool_call_id !== call.id) {
        throw new Error('invalid_discovery_tool_transcript');
      }
      ids.add(call.id);
    }
  }
  return ids;
}

function parseFunctionCalls(message: Record<string, unknown>, names: ReadonlySet<string>, previousIds: ReadonlySet<string>) {
  const { content, tool_calls: calls } = message;
  if ((typeof content !== 'string' && content !== null) || !Array.isArray(calls) || calls.length < 1 || calls.length > 8) return;
  const ids = new Set(previousIds);
  const toolCalls: FunctionCall[] = [];
  const parsedArguments: Record<string, unknown>[] = [];
  for (const value of calls) {
    const call = object(value);
    const { name, arguments: rawArgs } = object(call?.function) ?? {};
    // Reject the whole batch before dispatch if any call was not advertised or cannot be paired safely.
    if (call?.type !== 'function' || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(call.id)
      || ids.has(call.id) || typeof name !== 'string' || !names.has(name) || typeof rawArgs !== 'string') return;
    let args: Record<string, unknown> | undefined;
    try { args = object(JSON.parse(rawArgs)); }
    catch { return; }
    if (!args) return;
    ids.add(call.id);
    toolCalls.push({ type: 'function', id: call.id, function: { name, arguments: rawArgs } });
    parsedArguments.push(args);
  }
  const assistant: FunctionCallMessage = { role: 'assistant', content, tool_calls: toolCalls };
  return { message: assistant, arguments: parsedArguments };
}

export function createDiscoveryProvider(prices: Prices, transport = transportOnce) {
  const { model, key, inputCnyPerMillion, outputCnyPerMillion } = prices;
  if (!compatibleModels.has(model) || prices.pricedModel !== model || !key?.trim()
    || /\s/.test(key) || discoveryCostMicros(inputCnyPerMillion, outputCnyPerMillion, 1, 1) === null) return null;

  return {
    model, inputCnyPerMillion, outputCnyPerMillion,
    prepare(messages: readonly DiscoveryMessage[], maxOutputTokens: number, options?: DiscoveryToolOptions) {
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4000) {
        throw new Error('invalid_discovery_output_limit');
      }
      const body: ProviderBody = {
        model, messages: structuredClone(messages), thinking: { type: 'disabled' },
        response_format: { type: 'json_object' }, stream: false, max_tokens: maxOutputTokens,
      };
      if (options) {
        body.tools = options.tools.map(tool => ({ type: 'function', function: structuredClone(tool) }));
        body.tool_choice = options.toolChoice;
      }
      const names = new Set(body.tools?.map(tool => tool.function.name));
      const previousIds = transcriptCallIds(body.messages, names);
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
          if (choice?.finish_reason === 'length') return { delivery: 'response_received', usage, response: 'length' };
          const message = object(choice?.message);
          if (message?.role === 'assistant' && message.server_tool_calls == null) {
            if (choice?.finish_reason === 'tool_calls' && body.tool_choice === 'auto') {
              const calls = parseFunctionCalls(message, names, previousIds);
              if (calls) return { delivery: 'response_received', usage, response: 'tools', ...calls };
            }
            const { content, tool_calls: calls } = message;
            if (choice?.finish_reason === 'stop' && (calls == null || (Array.isArray(calls) && calls.length === 0))
              && typeof content === 'string' && content.trim()) {
              return { delivery: 'response_received', usage, response: 'ok', content };
            }
          }
          return { delivery: 'response_received', usage, response: 'error' };
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
