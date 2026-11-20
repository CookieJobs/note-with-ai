import mongoose from 'mongoose';
import { config } from '../config';
import Run from '../models/NoteDiscoveryRun';
import Discovery from '../models/NoteDiscovery';
import Preference from '../models/NoteDiscoveryPreference';
import { summarizeDiscoveryMetrics } from '../services/noteDiscoveryMetrics';

async function main() {
  const since = new Date(process.argv[2] ?? '');
  if (!Number.isFinite(since.getTime())) throw new Error('Provide cohort start as ISO date');
  await mongoose.connect(config.MONGODB_URI);
  try {
    // Projections intentionally exclude private text and feedback source baselines.
    const runs = await Run.find({ createdAt: { $gte: since } }, { status: 1, generation: 1, startedAt: 1, finishedAt: 1, 'usage.costCnyMicros': 1 })
      .limit(10001).maxTimeMS(5000).lean();
    if (runs.length > 10000) throw new Error('Narrow cohort to at most 10000 runs');
    const published = runs.filter(row => row.status === 'completed').map(row => ({ runId: row._id, generation: row.generation }));
    const discoveries = await Discovery.find(published.length ? { $or: published } : { _id: { $in: [] } }, {
      userId: 1, observationFingerprint: 1, exposedAt: 1, sessionId: 1, savedNoteId: 1,
    }).maxTimeMS(5000).lean();
    const ids = new Set(discoveries.filter(row => row.exposedAt).map(row => String(row._id)));
    const preferences = await Preference.find({ 'feedback.discoveryId': { $in: [...ids] } }, {
      'feedback.discoveryId': 1, 'feedback.kind': 1, 'feedback.revokedAt': 1, 'feedback.expiresAt': 1,
    }).maxTimeMS(5000).lean();
    console.log(JSON.stringify(summarizeDiscoveryMetrics({ runs,
      discoveries: discoveries.map(row => ({ ...row, userId: String(row.userId) })),
      feedback: preferences.flatMap(row => row.feedback).filter(row => ids.has(String(row.discoveryId)))
        .map(row => ({ ...row, discoveryId: String(row.discoveryId) })),
    }), null, 2));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => {
  console.error('Metrics report failed; narrow the cohort and verify authorized database access.');
  process.exitCode = 1;
});
