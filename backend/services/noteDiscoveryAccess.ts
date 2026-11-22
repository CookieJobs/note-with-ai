import { Types } from 'mongoose';
import { config } from '../config';
import User from '../models/User';

export function hasNoteDiscoveryGrant(userId: string, grant: boolean | null | undefined): boolean {
  return grant ?? (config.NOTE_DISCOVERY_LOCAL_USER_ID === userId.toLowerCase());
}

export async function isNoteDiscoveryAccessGranted(userId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(userId)) return false;
  const user = await User.findById(userId).select('isActive +noteDiscoveryAccess').lean<{ isActive?: boolean; noteDiscoveryAccess?: boolean | null } | null>();
  return !!user && user.isActive !== false && hasNoteDiscoveryGrant(userId, user.noteDiscoveryAccess);
}

/** Match the same persisted grant and legacy dev fallback when scanning account owners. */
export function noteDiscoveryAccountFilter(prefix = '') {
  const id = prefix + '_id';
  const active = prefix + 'isActive';
  const access = prefix + 'noteDiscoveryAccess';
  const localUserId = config.NOTE_DISCOVERY_LOCAL_USER_ID;
  return {
    [active]: { $ne: false },
    $or: [
      { [access]: true },
      ...(localUserId ? [{ [id]: new Types.ObjectId(localUserId), [access]: null }] : []),
    ],
  };
}
