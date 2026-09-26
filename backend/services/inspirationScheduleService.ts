import InspirationSettings from '../models/InspirationSettings';
import { config } from '../config';
import { inspirationError } from './inspirationTypes';

const DAY_MS = 86_400_000;
export type InspirationSettingsDto = {
  enabled: boolean;
  consentedAt: string | null;
  nextEligibleAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: string | null;
};

function dateString(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDto(record: Record<string, unknown> | null): InspirationSettingsDto {
  return {
    enabled: record?.enabled === true,
    consentedAt: dateString(record?.consentedAt),
    nextEligibleAt: dateString(record?.nextEligibleAt),
    lastAttemptAt: dateString(record?.lastAttemptAt),
    lastStatus: typeof record?.lastStatus === 'string' ? record.lastStatus : null,
  };
}

export class InspirationScheduleService {
  constructor(private readonly hasProviders: () => boolean) {}

  async get(userId: string): Promise<InspirationSettingsDto> {
    const record = await InspirationSettings.findOne({ userId }).lean();
    return toDto(record as Record<string, unknown> | null);
  }

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.get(userId)).enabled;
  }

  async setEnabled(userId: string, enabled: boolean, now: Date = new Date()): Promise<InspirationSettingsDto> {
    if (enabled && !this.hasProviders()) throw inspirationError('SEARCH_PROVIDER_UNAVAILABLE', 503);
    try {
      await InspirationSettings.updateOne({ userId }, { $setOnInsert: { enabled: false } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    if (enabled) {
      await InspirationSettings.findOneAndUpdate(
        { userId, enabled: false },
        { $set: { enabled: true, consentedAt: now, nextEligibleAt: new Date(now.getTime() + DAY_MS), lastStatus: null } },
        { new: true },
      );
    } else {
      await InspirationSettings.findOneAndUpdate(
        { userId }, { $set: { enabled: false, nextEligibleAt: null } }, { new: true },
      );
    }
    return this.get(userId);
  }

  async recordManualStart(userId: string, at: Date = new Date()): Promise<void> {
    await InspirationSettings.updateOne(
      { userId, enabled: true },
      { $max: { nextEligibleAt: new Date(at.getTime() + DAY_MS) } },
    );
  }
}

export function createInspirationScheduleService(options: { hasProviders?: () => boolean } = {}) {
  return new InspirationScheduleService(options.hasProviders || (() => Boolean(config.DEEPSEEK_API_KEY && config.TAVILY_API_KEY)));
}

export const inspirationScheduleService = createInspirationScheduleService();
