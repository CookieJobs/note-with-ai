import cron from 'node-cron';
import InspirationSettings from '../models/InspirationSettings';
import { inspirationService } from './inspirationService';

let started = false;

export function startInspirationScheduler() {
  if (started) return;
  started = true;
  cron.schedule('17 * * * *', () => {
    void (async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const settings = await InspirationSettings.find({
        proactiveEnabled: true,
        $or: [{ lastProactiveRunAt: { $exists: false } }, { lastProactiveRunAt: { $lt: cutoff } }],
      }).lean();
      for (const setting of settings as any[]) {
        const userId = String(setting.userId);
        try {
          await inspirationService.request(userId, 'proactive');
          await InspirationSettings.updateOne({ _id: setting._id }, { $set: { lastProactiveRunAt: new Date() } });
        } catch {
          // A failed external provider is intentionally quiet; the job/API surface exposes the state.
        }
      }
    })();
  });
}

