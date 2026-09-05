import mongoose from 'mongoose';

const NoteAiPreferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', required: true },
  included: { type: Boolean, required: true, default: true },
  updatedAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

NoteAiPreferenceSchema.index({ userId: 1, noteId: 1 }, { unique: true });

const NoteAiPreference = mongoose.models.NoteAiPreference || mongoose.model('NoteAiPreference', NoteAiPreferenceSchema);
export default NoteAiPreference;

