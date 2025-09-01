import express from 'express';
import { Note } from '../models/Note';
import { extractSearchKeywords, chatWithDeepSeek } from '../services/deepseek';
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

// 将笔记内容拆分为片段（内容节点）
const splitContentIntoNodes = (content: string): string[] => {
  if (!content) return [];
  // 先按换行切分，再按常见中英文标点进一步拆分
  const roughParts = content
    .split(/\n+/)
    .flatMap(line => line.split(/[。！？!\?；;：:]/g))
    .map(s => s.trim())
    .filter(Boolean);
  // 过滤过短或过长的片段，保留信息量适中的句子
  return roughParts.filter(s => s.length >= 4 && s.length <= 200);
};

// GET /api/for-me/robot/intro - 基于随机笔记片段生成关怀性开场白
router.get('/robot/intro', authenticateToken, asyncHandler(async (req: any, res: any) => {
  const user = await UserValidator.authenticateUser(req);

  // 读取用户全部笔记
  const notes = await Note.find({ userId: user._id }).sort({ createdAt: -1 });
  if (!notes || notes.length === 0) {
    return ResponseHandler.success(res, {
      noteId: null,
      noteTitle: '',
      snippet: '',
      aiOpening: '我还没有看到你的任何笔记，要不要先去记录一点近期的想法或身体状况呢？'
    }, '暂无笔记');
  }

  // 随机选择一条笔记
  const randomNote = notes[Math.floor(Math.random() * notes.length)];
  const nodes = splitContentIntoNodes(randomNote.content || '');

  if (!nodes || nodes.length === 0) {
    // 若无法拆分，退化为整段摘要
    const fallbackSnippet = (randomNote.content || '').slice(0, 60);
    const prompt = `你将看到用户过往笔记中的一个片段，请用体贴、自然的语气发起一句关怀性中文开场白，最多40字，不要复述片段。片段："${fallbackSnippet}"`;
    try {
      const aiOpening = await chatWithDeepSeek([
        { role: 'system', content: '你是一个温暖、克制的生活助手。请基于用户过去的笔记片段，主动给出一句简短的关怀问候或追问，语气自然，不要暴露隐私。' },
        { role: 'user', content: prompt }
      ]);
      return ResponseHandler.success(res, {
        noteId: randomNote._id.toString(),
        noteTitle: randomNote.title,
        snippet: fallbackSnippet,
        aiOpening
      }, '生成成功');
    } catch (e) {
      const aiOpening = '最近还好吗？我注意到你曾记录了一些重要事项，想关心一下你的近况。';
      return ResponseHandler.success(res, {
        noteId: randomNote._id.toString(),
        noteTitle: randomNote.title,
        snippet: fallbackSnippet,
        aiOpening
      }, '生成成功(降级)');
    }
  }

  // 随机选择一个内容节点
  const snippet = nodes[Math.floor(Math.random() * nodes.length)];

  // 组装对话，要求产出一条开场白
  const system = '你是一个温暖、克制的生活助手。请基于用户过去的笔记片段，主动给出一句简短的关怀问候或追问，语气自然，避免复述原文，不要进行医疗建议。最多40字。';
  const userMsg = `用户过往笔记片段："${snippet}"。请仅返回一句中文开场白，例如「您的膝盖恢复情况如何？」或「最近睡眠有改善吗？」。`;

  try {
    const aiOpening = await chatWithDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: userMsg }
    ]);

    return ResponseHandler.success(res, {
      noteId: randomNote._id.toString(),
      noteTitle: randomNote.title,
      snippet,
      aiOpening
    }, '生成成功');
  } catch (error) {
    // DeepSeek 不可用时的兜底
    let aiOpening = '最近过得还好吗？看到你之前的记录，我想来问候一下。';
    if (/膝盖|膝关节/.test(snippet)) {
      aiOpening = '您的膝盖恢复情况如何？有没有感觉好一些？';
    }
    return ResponseHandler.success(res, {
      noteId: randomNote._id.toString(),
      noteTitle: randomNote.title,
      snippet,
      aiOpening
    }, '生成成功(降级)');
  }
}));

export default router;