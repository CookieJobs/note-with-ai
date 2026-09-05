import { z } from 'zod';
import ProductEvent, { PRODUCT_EVENT_NAMES, type ProductEventName } from '../models/ProductEvent';
import { logger } from '../utils/logger';

const stringProperty = z.string().max(100);
const propertySchemas = {
  user_registered: z.object({}).strict(),
  user_active_day: z.object({}).strict(),
  note_created: z.object({}).strict(),
  chat_turn_committed: z.object({}).strict(),
  association_opened: z.object({ surface: z.enum(['notes', 'chat']) }).strict(),
  feedback_submitted: z.object({}).strict(),
  memory_viewed: z.object({}).strict(),
  memory_evidence_opened: z.object({ memoryId: stringProperty }).strict(),
  memory_confirmed: z.object({}).strict(),
  memory_corrected: z.object({}).strict(),
  memory_deleted: z.object({}).strict(),
  note_ai_preference_changed: z.object({ included: z.boolean() }).strict(),
  publication_created: z.object({}).strict(),
  publication_snapshot_updated: z.object({}).strict(),
  publication_revoked: z.object({}).strict(),
  inspiration_requested: z.object({}).strict(),
  inspiration_source_opened: z.object({ inspirationId: stringProperty }).strict(),
  inspiration_generated: z.object({}).strict(),
  inspiration_generation_failed: z.object({}).strict(),
  inspiration_saved: z.object({}).strict(),
  inspiration_dismissed: z.object({}).strict(),
} as const;

const eventSchema = z.object({
  name: z.enum(PRODUCT_EVENT_NAMES),
  userId: z.string().min(1),
  source: z.enum(['server', 'web']),
  properties: z.record(z.string(), z.union([stringProperty, z.number(), z.boolean(), z.null()])),
  occurredAt: z.date().optional(),
}).strict();

export type ProductEventInput = {
  name: ProductEventName;
  userId: string;
  source: 'server' | 'web';
  properties: Record<string, string | number | boolean | null>;
  occurredAt?: Date;
};

function shanghaiDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'PRODUCT_EVENT_WRITE_FAILED';
}

export class ProductEventService {
  static async trackProductEvent(input: ProductEventInput): Promise<void> {
    const parsed = eventSchema.parse(input);
    const properties = propertySchemas[parsed.name].parse(parsed.properties);
    const occurredAt = parsed.occurredAt ?? new Date();
    await ProductEvent.create({ ...parsed, properties, occurredAt, dayKey: shanghaiDayKey(occurredAt) });
  }

  static trackProductEventBestEffort(input: ProductEventInput): void {
    void this.trackProductEvent(input).catch((error: unknown) => {
      logger.warn('产品事件写入失败', { eventName: input.name, userId: input.userId, errorCode: errorCode(error) });
    });
  }

  static trackActiveDay(userId: string, occurredAt = new Date()): void {
    const dayKey = shanghaiDayKey(occurredAt);
    void ProductEvent.updateOne(
      { name: 'user_active_day', userId, dayKey },
      { $setOnInsert: { name: 'user_active_day', userId, dayKey, source: 'server', properties: {}, occurredAt } },
      { upsert: true },
    ).catch((error: unknown) => {
      logger.warn('产品事件写入失败', { eventName: 'user_active_day', userId, errorCode: errorCode(error) });
    });
  }

  static async recordWebEvent(userId: string, name: ProductEventName, properties: Record<string, string | number | boolean | null>): Promise<void> {
    if (!['association_opened', 'memory_evidence_opened', 'inspiration_source_opened'].includes(name)) throw new Error('不允许上报该事件');
    await this.trackProductEvent({ name, userId, source: 'web', properties });
  }
}

export const trackProductEvent = ProductEventService.trackProductEvent.bind(ProductEventService);
export const trackProductEventBestEffort = ProductEventService.trackProductEventBestEffort.bind(ProductEventService);
export const trackActiveDay = ProductEventService.trackActiveDay.bind(ProductEventService);
