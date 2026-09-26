import { randomUUID } from 'node:crypto';
import InspirationResearchGate from '../models/InspirationResearchGate';

const LEASE_MS = 20 * 60_000;

export class InspirationResearchGateService {
  async acquire(userId: string, origin: 'manual' | 'scheduled', now: Date = new Date()): Promise<string | null> {
    try {
      await InspirationResearchGate.updateOne(
        { userId }, { $setOnInsert: { token: null, busyUntil: null, origin: null } }, { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const token = randomUUID();
    const gate = await InspirationResearchGate.findOneAndUpdate(
      { userId, $or: [{ busyUntil: { $lte: now } }, { busyUntil: null }] },
      { $set: { token, origin, busyUntil: new Date(now.getTime() + LEASE_MS) } },
      { new: true },
    );
    return gate ? token : null;
  }

  async release(userId: string, token: string): Promise<void> {
    await InspirationResearchGate.updateOne(
      { userId, token }, { $set: { token: null, origin: null, busyUntil: null } },
    );
  }
}

export function createInspirationResearchGate() { return new InspirationResearchGateService(); }
export const inspirationResearchGate = createInspirationResearchGate();
