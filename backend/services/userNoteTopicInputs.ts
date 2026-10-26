import { createHash } from 'node:crypto';

export const TOPIC_ALIAS_VERSION = '1';

export interface TopicInputNote {
  revision: number;
  title?: string | null;
  content?: string | null;
  contentText?: string | null;
  summary?: string | null;
  keywords?: readonly string[] | null;
}

export interface TopicInputs {
  sourceRevision: number;
  sourceFingerprint: string;
  source: 'keywords' | 'summary' | 'bounded_content' | 'mixed';
  promptText: string;
  candidateTopics: string[];
}

const MAX_PROMPT_CODE_POINTS = 3_000;
const FINGERPRINT_VERSION = 1;
const topicAliases: ReadonlyMap<string, string> = new Map([
  ['ai', '人工智能'],
  ['人工智能', '人工智能'],
]);

function normalizeSourceValue(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

export function normalizeTopicLabel(label: string): string {
  const normalized = label
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/\p{Script=Latin}/gu, (letter) => letter.toLowerCase());

  return topicAliases.get(normalized) ?? normalized;
}

function uniqueTopics(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const value of values) {
    const topic = normalizeTopicLabel(value);
    if (topic && !seen.has(topic)) {
      seen.add(topic);
      topics.push(topic);
    }
  }
  return topics;
}

function extractSummaryTopics(summary: string): string[] {
  // Only an explicit topic/keyword field is reliable enough to avoid an AI extraction.
  const match = summary.match(/(?:主题|话题|关键词|topics?)\s*[:：]\s*([^\n。.!！?？]+)/iu);
  if (!match) return [];
  return uniqueTopics(match[1].split(/[、,，;；|｜]/u));
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  return Array.from(value).slice(0, maxCodePoints).join('');
}

export function buildTopicInputs(note: TopicInputNote): TopicInputs {
  const canonicalSource = {
    version: FINGERPRINT_VERSION,
    aliasVersion: TOPIC_ALIAS_VERSION,
    title: normalizeSourceValue(note.title),
    content: normalizeSourceValue(note.content),
    contentText: normalizeSourceValue(note.contentText),
    summary: normalizeSourceValue(note.summary),
    keywords: (note.keywords ?? []).map(normalizeSourceValue),
  };
  const sourceFingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalSource), 'utf8')
    .digest('hex');

  const keywords = uniqueTopics(canonicalSource.keywords);
  const summary = extractSummaryTopics(canonicalSource.summary);
  const candidateTopics = uniqueTopics([...keywords, ...summary]);
  const hasKeywords = keywords.length > 0;
  const hasSummary = summary.length > 0;
  const source: TopicInputs['source'] = hasKeywords && hasSummary
    ? 'mixed'
    : hasKeywords
      ? 'keywords'
      : hasSummary
        ? 'summary'
        : 'bounded_content';

  const body = normalizeSourceValue(note.contentText) || normalizeSourceValue(note.content);
  const promptText = truncateCodePoints(
    [canonicalSource.title, canonicalSource.summary, body].filter(Boolean).join('\n\n'),
    MAX_PROMPT_CODE_POINTS,
  );

  return {
    sourceRevision: note.revision,
    sourceFingerprint,
    source,
    promptText,
    candidateTopics,
  };
}
