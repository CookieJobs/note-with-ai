import mongoose from 'mongoose';

export interface NoteDiscoveryBilling {
  model: string;
  embeddingProvider: string;
  embeddingModel: string;
  inputPrice: number;
  outputPrice: number;
  embeddingPrice: number;
  userCapMicros: number;
  globalCapMicros: number;
  attemptCapMicros: number;
}

interface NoteDiscoveryEnvironmentSetting {
  _id: string;
  enabled?: boolean;
  billing?: NoteDiscoveryBilling;
  billingRevision?: string;
}

const schema = new mongoose.Schema<NoteDiscoveryEnvironmentSetting>({
  _id: { type: String, required: true },
  enabled: Boolean,
  billingRevision: String,
  billing: {
    type: new mongoose.Schema<NoteDiscoveryBilling>({
      model: { type: String, required: true },
      embeddingProvider: { type: String, required: true },
      embeddingModel: { type: String, required: true },
      inputPrice: { type: Number, required: true },
      outputPrice: { type: Number, required: true },
      embeddingPrice: { type: Number, required: true },
      userCapMicros: { type: Number, required: true },
      globalCapMicros: { type: Number, required: true },
      attemptCapMicros: { type: Number, required: true },
    }, { _id: false }),
    default: undefined,
  },
});

const modelName = 'NoteDiscoveryEnvironment';
const NoteDiscoveryEnvironment = mongoose.models[modelName]
  ? mongoose.model<NoteDiscoveryEnvironmentSetting>(modelName)
  : mongoose.model<NoteDiscoveryEnvironmentSetting>(modelName, schema);

export default NoteDiscoveryEnvironment;
