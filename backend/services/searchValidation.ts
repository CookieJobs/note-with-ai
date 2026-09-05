export type ProviderResultInput = {
  url?: unknown;
  title?: unknown;
  publisher?: unknown;
  snippet?: unknown;
  publishedAt?: unknown;
};

export type NormalizedProviderResult = {
  url: string;
  title: string;
  publisher?: string;
  snippet?: string;
  publishedAt?: string;
};

function isPrivateIpv4(hostname: string): boolean {
  const values = hostname.split('.').map(Number);
  if (values.length !== 4 || values.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return values[0] === 10
    || values[0] === 127
    || values[0] === 0
    || (values[0] === 169 && values[1] === 254)
    || (values[0] === 172 && values[1] >= 16 && values[1] <= 31)
    || (values[0] === 192 && values[1] === 168);
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === 'metadata.google.internal'
    || host.endsWith('.internal')
    || host === '::1'
    || host.startsWith('fc')
    || host.startsWith('fd')
    || host.startsWith('fe80:')
    || isPrivateIpv4(host);
}

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHostname(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.replace(/\s+/g, ' ').trim().slice(0, maximum);
  return result || undefined;
}

export function normalizeProviderResult(value: ProviderResultInput): NormalizedProviderResult | null {
  if (!isSafeExternalUrl(value.url)) return null;
  const title = boundedString(value.title, 300);
  if (!title) return null;
  const url = new URL(value.url);
  url.hash = '';
  const publishedCandidate = boundedString(value.publishedAt, 64);
  const publishedAt = publishedCandidate && !Number.isNaN(new Date(publishedCandidate).getTime()) ? new Date(publishedCandidate).toISOString() : undefined;
  return {
    url: url.toString(),
    title,
    ...(boundedString(value.publisher, 160) ? { publisher: boundedString(value.publisher, 160) } : {}),
    ...(boundedString(value.snippet, 1000) ? { snippet: boundedString(value.snippet, 1000) } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

