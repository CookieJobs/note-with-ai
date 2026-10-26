import { authFetch } from '../utils/auth';

export interface LegacyProfileDto {
  interests?: { topic: string; score: number }[];
  summary?: string;
  expertise?: { area: string; level: string }[];
  goals?: { description: string; timeframe: string; status: string }[];
  preferences?: Record<string, unknown>;
}

export interface ProfileAnalysisResponse {
  userProfile: LegacyProfileDto | null;
  historicalProfile: LegacyProfileDto | null;
  profileStatus: 'idle' | 'analyzing' | 'ready' | 'failed' | 'insufficient_data';
  noteCount: number;
  analysisError: string;
  analysisFailedAt: string | null;
  lastAnalyzedAt: string | null;
  analysisInputNoteCount: number | null;
  analysisInputScope: 'recent_up_to_20' | 'unknown' | null;
}

export interface ProfileAnalysisTriggerResponse {
  accepted: boolean;
  profileStatus: ProfileAnalysisResponse['profileStatus'];
  reason?: string;
  analysisError: string;
}

export interface UserStats {
  totalNotes: number;
  notesThisMonth: number;
}

const REQUEST_TIMEOUT_MS = 12_000;

async function getData<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new Error('Request aborted');
  const controller = new AbortController();
  let rejectCallerAbort: ((reason: Error) => void) | undefined;
  const callerAbort = signal ? new Promise<never>((_, reject) => { rejectCallerAbort = reject; }) : null;
  const abortFromCaller = () => {
    controller.abort();
    rejectCallerAbort?.(new Error('Request aborted'));
  };
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await authFetch(path, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error('Request failed');
      const body = await response.json();
      return body.data as T;
    })();
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Request timed out'));
        }, REQUEST_TIMEOUT_MS);
      }),
      ...(callerAbort ? [callerAbort] : []),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export const getProfileAnalysis = (signal?: AbortSignal): Promise<ProfileAnalysisResponse> =>
  getData('/api/profile/analysis', undefined, signal);

export const triggerProfileAnalysis = (signal?: AbortSignal): Promise<ProfileAnalysisTriggerResponse> =>
  getData('/api/profile/analysis', { method: 'POST' }, signal);

export const getStats = (signal?: AbortSignal): Promise<UserStats> => getData('/api/user/stats', undefined, signal);
