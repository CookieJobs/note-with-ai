export interface Note {
  _id: string;
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
  updatedAt?: string;
  enriching?: boolean;
}


