
import { Note } from '../models/Note';

export interface SearchResult {
  item: Record<string, unknown>;
  score: number;
}

export interface IVectorStore {
  search(userId: string, queryEmbedding: number[], limit: number): Promise<SearchResult[]>;
}

export class InMemoryVectorStore implements IVectorStore {
  private batchSize = 100; // Process 100 items at a time to avoid blocking

  async search(userId: string, queryEmbedding: number[], limit: number): Promise<SearchResult[]> {
    // 1. Fetch all notes for the user that have embeddings
    const notes = await Note.find({
      userId,
      embedding: { $exists: true, $ne: null, $not: { $size: 0 } }
    }).lean();

    if (!notes || notes.length === 0) {
      return [];
    }

    // 2. Calculate cosine similarity in a non-blocking way
    const scores: SearchResult[] = [];
    
    await this.processBatch(notes, queryEmbedding, scores);

    // 3. Sort and return top results
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async processBatch(notes: Record<string, unknown>[], queryEmbedding: number[], scores: SearchResult[]): Promise<void> {
    return new Promise((resolve) => {
      let index = 0;

      const processNextBatch = () => {
        const end = Math.min(index + this.batchSize, notes.length);
        
        for (let i = index; i < end; i++) {
          const note = notes[i];
          if (note.embedding && Array.isArray(note.embedding)) {
            const score = this.cosineSimilarity(queryEmbedding, note.embedding);
            scores.push({ item: note, score });
          }
        }

        index = end;

        if (index < notes.length) {
          setImmediate(processNextBatch);
        } else {
          resolve();
        }
      };

      processNextBatch();
    });
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
  }

  /**
   * Helper for performing search on in-memory candidates
   */
  searchInMemory(queryEmbedding: number[], candidates: Record<string, unknown>[], limit: number, threshold: number = 0): SearchResult[] {
    return candidates
      .map((item) => {
        const embedding = item.embedding;
        if (!embedding || !Array.isArray(embedding)) return { item, score: 0 };
        return { item, score: this.cosineSimilarity(queryEmbedding, embedding) };
      })
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

export const vectorStore = new InMemoryVectorStore();
