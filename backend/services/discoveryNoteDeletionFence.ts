import { Types } from 'mongoose';
import { Note } from '../models/Note';

/** Exact server-allocated target only. Keep its unique ID occupied after content erasure. */
export async function fenceDiscoveryNoteTarget(userId: string, noteId: string): Promise<void> {
  await Note.collection.updateOne({
    _id: new Types.ObjectId(noteId),
    $or: [{ userId: new Types.ObjectId(userId) }, { discoveryDeletedAt: { $exists: true } }],
  }, [{ $replaceWith: { _id: '$_id', discoveryDeletedAt: { $ifNull: ['$discoveryDeletedAt', '$$NOW'] } } }],
  { upsert: true, writeConcern: { w: 'majority', j: true } });
}
