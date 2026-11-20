import mongoose from 'mongoose';
/** Irreversible user tombstone. No content, credentials or model payloads are retained. */
const schema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true }, requestedAt: { type: Date, required: true }, cancelledSaveTargets: { type: [mongoose.Schema.Types.ObjectId], default: [] } }, { versionKey: false });
export const NoteDiscoveryCleanup = mongoose.models.NoteDiscoveryCleanup || mongoose.model('NoteDiscoveryCleanup', schema);
export async function isDiscoveryUserCleaningUp(userId: string): Promise<boolean> {
  return !!await NoteDiscoveryCleanup.exists({ userId });
}
