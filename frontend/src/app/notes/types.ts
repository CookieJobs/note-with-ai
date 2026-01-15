export interface Note {
  _id: string;
  title: string;
  content: string;
  contentJson?: any;
  contentText?: string;
  keywords: string[];
  embedding?: number[];
  createdAt: string;
  updatedAt?: string;
  enriching?: boolean;
}


