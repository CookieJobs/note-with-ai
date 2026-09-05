import { authFetch } from '../utils/auth';

export function recordProductEvent(name: 'memory_evidence_opened' | 'inspiration_source_opened', properties: { memoryId: string } | { inspirationId: string }): void {
  void authFetch('/api/events', { method: 'POST', body: JSON.stringify({ name, properties }) }).catch(() => undefined);
}
