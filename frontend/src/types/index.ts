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

export interface IUserProfile {
  id: string;
  username?: string;
  email: string;
  avatar?: string;
  createdAt: string;
}

export interface IRecommendCacheCandidate {
  s1?: number;
  s2?: number;
  type?: string;
  reason?: string;
  candidateUpdatedAt?: string;
  cachedAt?: string;
}

export interface IRecommendationDiagnostics {
  stage?: 'context' | 'recall' | 'rerank';
  reason?: string;
  totalVectorNotes?: number;
  totalScoredCandidates?: number;
  totalRerankedCandidates?: number;
  totalQueryEmbeddings?: number;
  readyQueryEmbeddings?: number;
  bestS1Score?: number;
  bestS2Score?: number;
  bestFinalScore?: number;
  candidateCountsByThreshold?: Record<string, number>;
}

export interface IRecommendCache {
  algoVersion?: string;
  sourceUpdatedAt?: string;
  generatedAt?: string;
  params?: {
    recallK?: number;
    finalK?: number;
    s1Threshold?: number;
    hardThreshold?: number;
  };
  diagnostics?: IRecommendationDiagnostics;
  byCandidateId?: Record<string, IRecommendCacheCandidate>;
}

export interface INote {
  _id: string;
  userId: string;
  content: string;
  contentJson?: Record<string, unknown>;
  contentText?: string;
  title?: string;
  summary?: string;
  concepts?: string[];
  recommendCache?: IRecommendCache | null;
  keywords?: string[];
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}
