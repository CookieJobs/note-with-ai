// backend/services/search.ts

// 模拟从网络搜索相关文章
// 未来可替换为调用 Google/Bing/Zhihu/微信公众号爬虫等
export async function searchArticlesByKeyword(keywords: string[]): Promise<{ title: string; url: string }[]> {
    // 模拟数据
    const dummyResults = keywords.flatMap((kw, index) => [
      {
        title: `关于「${kw}」的深度文章 ${index + 1}`,
        url: `https://example.com/article-${kw}-${index + 1}`,
      },
      {
        title: `从零理解「${kw}」的关键概念`,
        url: `https://example.com/guide-${kw}-${index + 1}`,
      },
    ]);
  
    return dummyResults;
  }
  