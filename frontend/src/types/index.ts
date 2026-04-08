// Frontend types adapted from backend/types/index.ts

export interface IMessage {
  role: 'user' | 'assistant';
  content: string;
  // Frontend specific extensions
  relatedNotes?: IRelatedNote[];
  searchingNotes?: boolean;
}

export interface IRelatedNote {
  noteId: string; // Corresponds to backend noteId (ObjectId string)
  id?: string; // Sometimes frontend uses id, but we should prefer noteId
  title?: string;
  content?: string;
  score?: number; // Backend uses score
  similarity?: number; // Frontend legacy use, should migrate to score
  matchType?: string;
  reason?: string;
  createdAt?: string;
}

export interface IChat {
  _id?: string; // MongoDB _id
  id: string; // Frontend ID
  userId?: string;
  title: string;
  messages: IMessage[];
  relatedNotes?: IRelatedNote[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CareIntro {
  noteId: string | null;
  noteTitle: string;
  snippet: string;
  aiOpening: string;
}

export interface INote {
  _id: string;
  userId: string;
  content: string;
  contentJson?: any;
  contentText?: string;
  title?: string;
  summary?: string;
  concepts?: string[];
  recommendCache?: any;
  keywords?: string[];
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}
