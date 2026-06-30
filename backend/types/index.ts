import { Document, Types } from 'mongoose';

export type EmbeddingMetadataModality = 'text' | 'image' | 'image_text';

export interface INoteEmbeddingImageExtension {
  assetIds?: string[];
}

export interface INoteEmbeddingMetadata {
  provider: string;
  model: string;
  dimension: number;
  modality: EmbeddingMetadataModality;
  updatedAt: Date;
  image: INoteEmbeddingImageExtension | null;
}

export interface IMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface IRelatedNote {
  noteId: Types.ObjectId;
  title?: string;
  content?: string;
  score?: number;
  matchType?: string;
  reason?: string;
  createdAt?: Date;
}

export interface IChat extends Document {
  userId: Types.ObjectId;
  title: string;
  messages: IMessage[];
  relatedNotes?: IRelatedNote[];
  createdAt: Date;
  updatedAt: Date;
}

export interface INote extends Document {
  userId: Types.ObjectId;
  content: string;
  contentJson?: Record<string, unknown>;
  contentText?: string;
  title?: string;
  summary?: string;
  concepts?: string[];
  recommendCache?: Record<string, unknown>;
  keywords?: string[];
  embedding?: number[];
  embeddingMetadata?: INoteEmbeddingMetadata | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserProfile extends Document {
  userId: Types.ObjectId;
  interests: { topic: string; score: number; lastUpdated: Date }[];
  expertise: { area: string; level: 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert' }[];
  goals: { description: string; timeframe: 'Short-term' | 'Long-term'; status: 'Active' | 'Completed' | 'Abandoned'; createdAt: Date }[];
  preferences: {
    communicationStyle: string;
    contentFocus: string[];
    feedbackMode: 'Gentle' | 'Direct';
  };
  summary: string;
  analysisStatus: 'idle' | 'queued' | 'running' | 'ready' | 'failed';
  analysisVersion: number;
  analysisRequestedAt: Date | null;
  analysisStartedAt: Date | null;
  analysisError: string;
  lastAnalyzedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
