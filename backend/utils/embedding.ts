// backend/utils/embedding.ts

// 计算两个向量的余弦相似度
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
  
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
  }
  
  // 获取与某个 embedding 最相似的笔记
  export function findTopMatches<T extends { embedding: number[] }>(
    queryEmbedding: number[],
    items: T[],
    topK = 5,
    threshold = 0.75
  ): { item: T; score: number }[] {
    const scored = items
      .map((item) => ({ item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  
    return scored;
  }
  