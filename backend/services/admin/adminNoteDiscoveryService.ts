import { isObjectIdOrHexString } from 'mongoose';
import { getNoteDiscoveryEnvironment } from '../noteDiscoveryEnvironment';
import User from '../../models/User';
import { ErrorHandler } from '../../utils/errorHandler';
import { hasNoteDiscoveryGrant } from '../noteDiscoveryAccess';
import { noteDiscoveryWorkerStore } from '../noteDiscoveryWorkerStore';

export async function getAdminNoteDiscoveryAccess(id: string) {
  if (!isObjectIdOrHexString(id)) throw ErrorHandler.createNotFoundError('用户不存在');
  const user = await User.findById(id).select('isActive +noteDiscoveryAccess').lean<{ noteDiscoveryAccess?: boolean | null } | null>();
  if (!user) throw ErrorHandler.createNotFoundError('用户不存在');
  return { granted: hasNoteDiscoveryGrant(id, user.noteDiscoveryAccess), environment: await getNoteDiscoveryEnvironment() };
}

export async function setAdminNoteDiscoveryAccess(id: string, granted: boolean) {
  if (!isObjectIdOrHexString(id)) throw ErrorHandler.createNotFoundError('用户不存在');
  const filter = granted ? { _id: id, isActive: { $ne: false } } : { _id: id };
  const user = await User.findOneAndUpdate(filter, { $set: { noteDiscoveryAccess: granted } }, { new: true, writeConcern: { w: 'majority', j: true } })
    .select('_id').lean();
  if (!user) {
    if (granted && await User.exists({ _id: id, isActive: false })) {
      throw ErrorHandler.createValidationError('请先恢复该用户，再开放笔记发现试用');
    }
    throw ErrorHandler.createNotFoundError('用户不存在');
  }
  if (!granted) await noteDiscoveryWorkerStore.cancelAccountRuns(id);
  return { granted, environment: await getNoteDiscoveryEnvironment() };
}
