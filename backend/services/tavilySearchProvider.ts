import { config } from '../config';
import { inspirationError, type ResearchSource } from './inspirationTypes';

type TavilyCandidate = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type TavilyResponse = { results?: unknown };

export type TavilySearchProviderOptions = {
  apiKey?: string;
  language: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type TavilySearchProvider = {
  search(query: string): Promise<ResearchSource[]>;
};

const TRACKING_PARAMS = new Set(['gclid', 'fbclid']);

export function canonicalizeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, url.pathname === '/' && !url.search ? '' : '/');
  } catch {
    return null;
  }
}

function normalizeTavilyResults(value: unknown, now: () => Date): ResearchSource[] {
  const results = Array.isArray(value) ? value : [];
  const sources: ResearchSource[] = [];
  for (const candidateValue of results) {
    if (!candidateValue || typeof candidateValue !== 'object') continue;
    const candidate = candidateValue as TavilyCandidate;
    const canonicalUrl = canonicalizeSourceUrl(candidate.url);
    const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 300) : '';
    const snippet = typeof candidate.content === 'string' ? candidate.content.trim().slice(0, 1000) : '';
    if (!canonicalUrl || !title || !snippet) continue;
    const publisher = new URL(canonicalUrl).hostname;
    if (sources.some((source) => source.canonicalUrl === canonicalUrl)) continue;
    sources.push({
      sourceId: String(sources.length + 1),
      canonicalUrl,
      title,
      publisher: publisher.slice(0, 160),
      snippet,
      retrievedAt: now().toISOString(),
    });
    if (sources.length === 5) break;
  }
  return sources;
}

export function createTavilySearchProvider(options: TavilySearchProviderOptions): TavilySearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  return {
    async search(query: string): Promise<ResearchSource[]> {
      if (!options.apiKey) throw inspirationError('SEARCH_PROVIDER_UNAVAILABLE', 503);
      try {
        const response = await fetchImpl('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            search_depth: 'basic',
            max_results: 5,
            include_answer: false,
            include_raw_content: false,
            language: options.language,
          }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        if (!response.ok) throw inspirationError('SEARCH_PROVIDER_FAILED', 502);
        const payload = await response.json() as TavilyResponse;
        return normalizeTavilyResults(payload.results, now);
      } catch (error) {
        if ((error as { details?: { code?: string } })?.details?.code === 'SEARCH_PROVIDER_FAILED') throw error;
        throw inspirationError('SEARCH_PROVIDER_FAILED', 502);
      }
    },
  };
}

export const tavilySearchProvider = createTavilySearchProvider({
  apiKey: config.TAVILY_API_KEY,
  language: config.TAVILY_SEARCH_LANGUAGE,
  timeoutMs: config.TAVILY_SEARCH_TIMEOUT_MS,
});
