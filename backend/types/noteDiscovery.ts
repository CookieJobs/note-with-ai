import type { Types } from 'mongoose';
import type { IChat } from './index';
import type { NoteDto } from '../services/NoteUpdateOrchestrator';

export const DISCOVERY_RUN_STATUSES = ['queued', 'running', 'completed', 'no_result', 'failed', 'cancelled'] as const;
export const DISCOVERY_TRIGGERS = ['automatic', 'manual'] as const;
export const DISCOVERY_FAILURE_CATEGORIES = [
  'budget_exhausted', 'provider_unavailable', 'provider_failed', 'usage_unknown',
  'limit_exceeded', 'expired_lease', 'internal_error',
] as const;
export const DISCOVERY_KINDS = ['connection', 'follow_up', 'next_step'] as const;
export const DISCOVERY_STATUSES = ['ready', 'stale', 'dismissed', 'completed'] as const;
export const DISCOVERY_FEEDBACK_KINDS = ['not_interested', 'not_related', 'already_finished'] as const;
export const DEFAULT_DISCOVERY_TIME_ZONE = 'Asia/Shanghai';

export type DiscoveryRunStatus = typeof DISCOVERY_RUN_STATUSES[number];
export type DiscoveryTrigger = typeof DISCOVERY_TRIGGERS[number];
export type DiscoveryFailureCategory = typeof DISCOVERY_FAILURE_CATEGORIES[number];
export type DiscoveryKind = typeof DISCOVERY_KINDS[number];
export type DiscoveryStatus = typeof DISCOVERY_STATUSES[number];
export type DiscoveryFeedbackKind = typeof DISCOVERY_FEEDBACK_KINDS[number];

export interface DiscoveryWatermark<Id = string> {
  changedAt: Date;
  noteId?: Id;
  revision?: number;
}

export interface DiscoveryRunUsage {
  modelCalls: number;
  toolCalls: number;
  notesRead: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costCnyMicros: number | null;
}

export interface DiscoveryRunFence {
  runId: string;
  userId: string;
  leaseToken: string;
  generation: number;
}

export interface DiscoveryRunRecord {
  userId: Types.ObjectId;
  trigger: DiscoveryTrigger;
  status: DiscoveryRunStatus;
  idempotencyKey: string;
  watermark: DiscoveryWatermark<Types.ObjectId>;
  pendingWatermark?: DiscoveryWatermark<Types.ObjectId>;
  pendingIdempotencyKey?: string;
  pendingAvailableAt?: Date;
  pendingTrigger?: DiscoveryTrigger;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  generation: number;
  retryCount: number;
  providerStartedAt: Date | null;
  providerReservationId?: string | null;
  sentReservationIds?: string[];
  recoveringGeneration?: number | null;
  startedAt?: Date;
  finishedAt?: Date;
  usage?: DiscoveryRunUsage;
  failureCategory?: DiscoveryFailureCategory;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvidenceLocator {
  start: number;
  end: number;
}

export interface EvidenceInput {
  noteId: string;
  revision: number;
  excerpt: string;
}

export interface EvidenceDto extends EvidenceInput {
  title: string;
  noteDate: string;
  locator?: EvidenceLocator;
  hasImages: boolean;
}

export interface DiscoveryEvidenceSnapshot extends Omit<EvidenceDto, 'noteId' | 'noteDate'> {
  noteId: Types.ObjectId;
  noteDate: Date;
}

export interface DiscoveryQualityRationale {
  novelInsight: string;
  counterEvidence: string;
  missingInformation: string[];
}

export type DiscoveryQualityResult =
  | { passed: true; rationale: DiscoveryQualityRationale }
  | { passed: false; reason: string };

export interface DiscoveryCandidate {
  kind: DiscoveryKind;
  title: string;
  observation: string;
  whyNow: string;
  qualification: string;
  suggestedAction: string;
  draft?: string;
  evidence: EvidenceInput[];
  relationshipKey?: string;
  questionKey?: string;
  rationale: DiscoveryQualityRationale;
}

export interface DiscoveryRecord extends Omit<DiscoveryCandidate, 'evidence' | 'rationale'> {
  userId: Types.ObjectId;
  runId: Types.ObjectId;
  generation: number;
  status: DiscoveryStatus;
  evidence: DiscoveryEvidenceSnapshot[];
  sourceFingerprint: string;
  observationFingerprint: string;
  quality: Extract<DiscoveryQualityResult, { passed: true }>;
  exposedAt?: Date;
  sessionId?: Types.ObjectId;
  savedNoteId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscoveryFeedback<Id = string> {
  kind: DiscoveryFeedbackKind;
  discoveryId: Id;
  sourceIds: Id[];
  sourceFingerprint: string;
  observationFingerprint: string;
  relationshipKey?: string;
  questionKey?: string;
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

export interface DiscoveryPreferenceRecord {
  userId: Types.ObjectId;
  automaticEnabled: boolean;
  timeZone: string;
  feedback: DiscoveryFeedback<Types.ObjectId>[];
}

export interface DiscoveryDto {
  id: string;
  kind: DiscoveryKind;
  title: string;
  observation: string;
  whyNow: string;
  evidence: EvidenceDto[];
  qualification: string;
  suggestedAction: string;
  draft?: string;
  status: DiscoveryStatus;
  createdAt: string;
  exposedAt?: string;
  sessionId?: string;
  savedNoteId?: string;
}

export interface DiscoveryRunDto {
  status: 'idle' | 'queued' | 'running' | 'completed' | 'no_result' | 'budget_exhausted' | 'failed';
  retryAt?: string;
  errorCode?: string;
}

export interface DiscoveryListDto {
  items: DiscoveryDto[];
  run: DiscoveryRunDto;
}

export interface DiscoveryTriggerDto {
  runId: string;
  status: DiscoveryRunStatus;
}

export interface DiscoverySessionDto {
  session: IChat;
  reused: boolean;
}

export interface DiscoverySaveDto {
  note: NoteDto;
  discovery: DiscoveryDto;
}
