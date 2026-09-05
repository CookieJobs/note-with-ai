import axios from 'axios';
import { config } from '../config';
import { AppError, ErrorType } from '../utils/errorHandler';
import { normalizeProviderResult, type NormalizedProviderResult } from './searchValidation';

export interface SearchOptions { limit: number; }
export interface SearchResult {
  url: string;
  title: string;
  publisher?: string;
  snippet?: string;
  publishedAt?: string;
}
export interface SearchProvider { search(query: string, options: SearchOptions): Promise<SearchResult[]>; }

export function isSearchProviderConfigured() {
  return Boolean(config.SEARCH_PROVIDER_URL && config.SEARCH_PROVIDER_API_KEY);
}

class HttpSearchProvider implements SearchProvider {
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    if (!isSearchProviderConfigured()) {
      throw new AppError('目前无法寻找新灵感', ErrorType.EXTERNAL_API, 503, true, { code: 'SEARCH_PROVIDER_UNAVAILABLE' });
    }
    const response = await axios.post(config.SEARCH_PROVIDER_URL!, { query, limit: Math.max(1, Math.min(10, options.limit)) }, {
      headers: { Authorization: `Bearer ${config.SEARCH_PROVIDER_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    const records = Array.isArray(response.data?.results) ? response.data.results : [];
    return records.map(normalizeProviderResult).filter((value: NormalizedProviderResult | null): value is NormalizedProviderResult => value !== null);
  }
}

export const searchProvider: SearchProvider = new HttpSearchProvider();

export async function searchArticlesByKeyword(keywords: string[]): Promise<{ title: string; url: string }[]> {
  const results = await searchProvider.search(keywords.slice(0, 3).join(' ').slice(0, 160), { limit: 6 });
  return results.map(({ title, url }) => ({ title, url }));
}
export async function searchArticlesForNote(keywords: string[]): Promise<SearchResult[]> {
  return searchProvider.search(keywords.slice(0, 3).join(' ').slice(0, 160), { limit: 6 });
}
export async function searchWithMetaso(query: string): Promise<SearchResult[]> {
  return searchProvider.search(query.slice(0, 160), { limit: 6 });
}
