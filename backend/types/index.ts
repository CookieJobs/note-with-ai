import { Document, Types } from 'mongoose';

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
  contentJson?: any;
  contentText?: string;
  title?: string;
  summary?: string;
  concepts?: string[];
  recommendCache?: any;
  keywords?: string[];
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}
