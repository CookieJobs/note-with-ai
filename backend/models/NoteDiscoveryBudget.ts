import mongoose from 'mongoose';

export const PROVIDER_DELIVERY_DISPOSITIONS = ['response_received', 'not_sent', 'delivery_unknown'] as const;
export type ProviderDeliveryDisposition = typeof PROVIDER_DELIVERY_DISPOSITIONS[number];

export interface BudgetReservation {
  id: string;
  day: string;
  runId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  generation: number;
  leaseToken: string;
  leaseUntil: Date;
  provider: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  reservedMicros: number;
  state: 'reserved' | 'settled';
  createdAt: Date;
  settledAt?: Date;
  settledMicros?: number;
  outcome?: 'known' | 'unknown' | 'overrun';
  delivery?: ProviderDeliveryDisposition;
}

interface UserBudget {
  reservedMicros: number;
  spentMicros: number;
}

interface DiscoveryBudgetRecord {
  _id: string;
  reservedTotalMicros: number;
  spentTotalMicros: number;
  users: Map<string, UserBudget>;
  reservations: BudgetReservation[];
  blockedAt?: Date;
}

const nonnegativeInteger = { type: Number, min: 0, validate: Number.isSafeInteger, required: true } as const;
const UserBudgetSchema = new mongoose.Schema<UserBudget>({
  reservedMicros: nonnegativeInteger,
  spentMicros: nonnegativeInteger,
}, { _id: false });

const ReservationSchema = new mongoose.Schema<BudgetReservation>({
  id: { type: String, required: true, maxlength: 48 },
  day: { type: String, required: true, maxlength: 10 },
  runId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  generation: nonnegativeInteger,
  leaseToken: { type: String, required: true, maxlength: 100 },
  leaseUntil: { type: Date, required: true },
  provider: { type: String, required: true, maxlength: 200 },
  model: { type: String, required: true, maxlength: 200 },
  maxInputTokens: nonnegativeInteger,
  maxOutputTokens: nonnegativeInteger,
  reservedMicros: nonnegativeInteger,
  state: { type: String, required: true, enum: ['reserved', 'settled'] },
  createdAt: { type: Date, required: true },
  settledAt: { type: Date },
  settledMicros: { ...nonnegativeInteger, required: false },
  outcome: { type: String, enum: ['known', 'unknown', 'overrun'] },
  delivery: { type: String, enum: PROVIDER_DELIVERY_DISPOSITIONS },
}, { _id: false });

const NoteDiscoveryBudgetSchema = new mongoose.Schema<DiscoveryBudgetRecord>({
  _id: { type: String, required: true },
  reservedTotalMicros: nonnegativeInteger,
  spentTotalMicros: nonnegativeInteger,
  users: { type: Map, of: UserBudgetSchema, required: true, default: () => new Map() },
  reservations: { type: [ReservationSchema], required: true, default: [] },
  blockedAt: { type: Date },
}, { versionKey: false });

NoteDiscoveryBudgetSchema.index({ 'reservations.runId': 1 });
NoteDiscoveryBudgetSchema.index({ blockedAt: 1 }, { sparse: true });

export const NoteDiscoveryBudget = (mongoose.models.NoteDiscoveryBudget as mongoose.Model<DiscoveryBudgetRecord>)
  || mongoose.model<DiscoveryBudgetRecord>('NoteDiscoveryBudget', NoteDiscoveryBudgetSchema);

export default NoteDiscoveryBudget;
