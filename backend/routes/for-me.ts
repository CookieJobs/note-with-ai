import express from 'express';
import { Note } from '../models/Note';
import { extractSearchKeywords } from '../services/deepseek';
import { searchArticlesForNote } from '../services/search';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler, ErrorHandler, ResponseHandler } from '../utils/errorHandler';
import { UserValidator, ResourceValidator } from '../utils/userValidation';
import crypto from 'crypto';

const router = express.Router();

// 文章分类映射
const categoryMapping: { [key: string]: string } = {
  'technology': '技术',
  'science': '科学',
  'business': '商业',
  'health': '健康',
  'education': '教育',
  'entertainment': '娱乐',
  'sports': '体育',
  'politics': '政治',
  'lifestyle': '生活方式',
  'travel': '旅行',
  'food': '美食',
  'art': '艺术',
  'finance': '金融',
  'environment': '环境',
  'general': '综合'
};

// 生成文章唯一ID
const generateArticleId = (url: string, title: string): string => {
  return crypto.createHash('md5').update(url + title).digest('hex').substring(0, 12);
};

// 计算相关度评分
const calculateRelevanceScore = (article: any, keywords: string[]): number => {
  const text = (article.title + ' ' + article.snippet).toLowerCase();
  let score = 0;
  let totalKeywords = keywords.length;
  
  keywords.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      score += 1;
    }
  });
  
  return totalKeywords > 0 ? score / totalKeywords : 0;
};

// 估算阅读时间（基于字数）
const estimateReadingTime = (text: string): number => {
  const wordsPerMinute = 200; // 平均阅读速度
  const wordCount = text.split(' ').length;
  return Math.max(1, Math.round(wordCount / wordsPerMinute));
};

// 获取文章分类
const getArticleCategory = (article: any, keywords: string[]): string => {
  const text = (article.title + ' ' + article.snippet).toLowerCase();
  
  // 基于关键词和内容判断分类
  if (keywords.some(k => ['技术', 'programming', 'code', 'software', 'tech'].includes(k.toLowerCase()))) {
    return '技术';
  }
  if (keywords.some(k => ['科学', 'science', 'research', 'study'].includes(k.toLowerCase()))) {
    return '科学';
  }
  if (keywords.some(k => ['商业', 'business', 'market', 'economy'].includes(k.toLowerCase()))) {
    return '商业';
  }
  if (keywords.some(k => ['健康', 'health', 'medical', 'fitness'].includes(k.toLowerCase()))) {
    return '健康';
  }
  if (keywords.some(k => ['教育', 'education', 'learning', 'study'].includes(k.toLowerCase()))) {
    return '教育';
  }
  
  return '综合';
};

// 生成推荐理由
const generateRecommendationReason = (article: any, keywords: string[]): string => {
  const matchedKeywords = keywords.filter(keyword => 
    (article.title + ' ' + article.snippet).toLowerCase().includes(keyword.toLowerCase())
  );
  
  if (matchedKeywords.length > 0) {
    return `与您的关键词"${matchedKeywords.slice(0, 2).join('、')}"高度相关`;
  }
  
  return '基于您的笔记内容推荐';
};

// GET /api/for-me - 获取当前用户笔记的推荐文章
router.get('/', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);
  
  // 获取当前用户的笔记
  const notes = await Note.find({ userId: user._id }).sort({ createdAt: -1 });
  
  if (notes.length === 0) {
    return ResponseHandler.success(res, []);
  }

    // 为每个笔记生成推荐文章
    const notesWithArticles = await Promise.all(
      notes.map(async (note: any) => {
        try {
          // 使用已有关键词或提取新关键词
          let keywords = note.keywords;
          if (!keywords || keywords.length === 0) {
            keywords = await extractSearchKeywords(note.content);
          }
          
          // 搜索相关文章
          const rawArticles = await searchArticlesForNote(keywords);
          
          // 增强文章信息
          const enhancedArticles = rawArticles.map((article: any) => ({
            id: generateArticleId(article.url, article.title),
            title: article.title,
            url: article.url,
            snippet: article.snippet,
            source: article.source,
            publishedAt: article.publishedAt,
            relevanceScore: calculateRelevanceScore(article, keywords),
            category: getArticleCategory(article, keywords),
            readingTime: estimateReadingTime(article.snippet),
            recommendationReason: generateRecommendationReason(article, keywords)
          }));
          
          // 按相关度排序并限制数量
          const sortedArticles = enhancedArticles
            .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
            .slice(0, 8); // 增加到8篇文章
          
          return {
            id: note._id.toString(),
            title: note.title,
            content: note.content,
            keywords: keywords,
            createdAt: note.createdAt,
            articles: sortedArticles
          };
        } catch (error) {
          console.error(`处理笔记 ${note._id} 时出错:`, error);
          return {
            id: note._id.toString(),
            title: note.title,
            content: note.content,
            keywords: note.keywords || [],
            createdAt: note.createdAt,
            articles: []
          };
        }
      })
    );

    return ResponseHandler.success(res, notesWithArticles);
  }));

// POST /api/for-me/refresh/:noteId - 刷新特定笔记的推荐文章
router.post('/refresh/:noteId', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);
  const { noteId } = req.params;
    
    // 查找当前用户的笔记
    const note = await Note.findOne({ _id: noteId, userId: req.user.userId });
    if (!note) {
      return res.status(404).json({ error: '笔记不存在或无权限访问' });
    }

    // 重新提取关键词
    const keywords = await extractSearchKeywords(note.content);
    
    // 搜索相关文章
    const rawArticles = await searchArticlesForNote(keywords);
    
    // 增强文章信息
    const enhancedArticles = rawArticles.map((article: any) => ({
      id: generateArticleId(article.url, article.title),
      title: article.title,
      url: article.url,
      snippet: article.snippet,
      source: article.source,
      publishedAt: article.publishedAt,
      relevanceScore: calculateRelevanceScore(article, keywords),
      category: getArticleCategory(article, keywords),
      readingTime: estimateReadingTime(article.snippet),
      recommendationReason: generateRecommendationReason(article, keywords)
    }));
    
    // 按相关度排序并限制数量
    const sortedArticles = enhancedArticles
      .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
      .slice(0, 8);
    
    // 返回更新后的数据
    const updatedNote = {
      id: note._id.toString(),
      title: note.title,
      content: note.content,
      keywords: keywords,
      createdAt: note.createdAt,
      articles: sortedArticles
    };

    return ResponseHandler.success(res, updatedNote);
  }));

export default router;