// backend/services/search.ts

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishDate?: string;
}

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

// 为 For Me 页面提供增强的搜索服务
export async function searchArticlesForNote(keywords: string[]): Promise<SearchResult[]> {
  // 模拟高质量的搜索结果
  const sources = ['知乎', '掘金', '博客园', 'CSDN', '简书', 'Medium'];
  const articleTypes = ['深度解析', '实战指南', '最佳实践', '技术分享', '经验总结', '案例研究'];
  
  const results: SearchResult[] = [];
  
  for (const keyword of keywords) {
    // 为每个关键词生成 2-3 个高质量结果
    const numResults = Math.floor(Math.random() * 2) + 2; // 2-3个结果
    
    for (let i = 0; i < numResults; i++) {
      const source = sources[Math.floor(Math.random() * sources.length)];
      const articleType = articleTypes[Math.floor(Math.random() * articleTypes.length)];
      
      results.push({
        title: `${keyword}${articleType}：从入门到精通`,
        url: `https://${source.toLowerCase()}.com/article/${keyword}-${i + 1}`,
        snippet: `这是一篇关于${keyword}的${articleType}文章，深入探讨了${keyword}的核心概念、实际应用场景以及最佳实践方法。文章通过详细的案例分析和实战经验分享，帮助读者全面理解${keyword}的重要性和应用价值...`,
        source: source,
        publishDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 最近30天内的随机日期
      });
    }
  }
  
  // 按发布日期排序，最新的在前
  return results.sort((a, b) => {
    if (!a.publishDate || !b.publishDate) return 0;
    return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime();
  });
}

// 秘塔 API 接口（预留，暂时使用模拟数据）
export async function searchWithMetaso(query: string): Promise<SearchResult[]> {
  // TODO: 集成秘塔 API
  // const conn = http.client.HTTPSConnection("metaso.cn")
  // const payload = {
  //   "q": query,
  //   "scope": "webpage",
  //   "includeSummary": false,
  //   "size": "10",
  //   "includeRawContent": false
  // }
  
  // 暂时返回模拟数据
  return searchArticlesForNote([query]);
}
  