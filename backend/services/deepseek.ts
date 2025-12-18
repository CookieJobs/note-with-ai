// backend/services/deepseek.ts
import dotenv from 'dotenv';
import { DeepSeekApiClient } from '../utils/apiClient';

dotenv.config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY environment variable is required');
}

// 创建DeepSeek API客户端实例
const deepSeekClient = new DeepSeekApiClient(DEEPSEEK_API_KEY);

/**
 * 与 DeepSeek 聊天模型对话
 */
export async function chatWithDeepSeek(messages: { role: 'user' | 'assistant' | 'system'; content: string }[]): Promise<string> {
  return await deepSeekClient.chatCompletion(messages, {
    temperature: 0.7,
    max_tokens: 1024
  });
}


/**
 * 为聊天对话生成标题
 */
export async function summarizeChatTitle(content: string): Promise<string> {
  try {
    const messages = [
      {
        role: 'system',
        content: `你是一个对话摘要助手。请根据用户和AI最近一轮的问答内容，生成一个高度概括且简洁的中文标题（不超过15字），只返回标题本身，不要包含任何解释或多余内容。`
      },
      {
        role: 'user',
        content
      }
    ];
    
    return await deepSeekClient.chatCompletion(messages, {
      max_tokens: 50,
      temperature: 0.1
    });
  } catch (error: any) {
    console.error('❌ summarizeChatTitle 解析失败：', error.message || error);
    return '未命名对话';
  }
}

/**
 * 为笔记生成标题和关键词
 */
export async function summarizeNote(content: string): Promise<{ title: string; keywords: string[] }> {
    try {
      const messages = [
        {
          role: 'system',
          content: `作为文本处理专家，请严格遵循以下规则：
                    1. 为用户提供的文本生成一个简洁准确的中文标题（严格≤15字）
                    2. 提取1-5个最能代表文本核心内容的中文关键词
                    3. 输出格式必须是纯JSON：{ "title": "标题", "keywords": ["词1", "词2"] }
                    4. 除了JSON格式的结果外，不要包含任何其他内容或解释`
        },
        {
          role: 'user',
          content
        }
      ];
  
      const text = await deepSeekClient.chatCompletion(messages, {
        max_tokens: 500,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });
      console.log('🧠 AI原始返回:', text);
  
      const parsed = JSON.parse(text);
      return {
        title: parsed.title || '未命名笔记',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
      };
    } catch (error: any) {
      console.error('❌ summarizeNote 解析失败：', error.message || error);
      return { title: '未命名笔记', keywords: [] };
    }
  }

/**
 * 专门为 For Me 页面提取搜索关键词
 */
export async function extractSearchKeywords(content: string): Promise<string[]> {
  try {
    const messages = [
      {
        role: 'system',
        content: `你是一个关键词提取专家。请从用户提供的笔记内容中提取2-4个最适合用于搜索相关文章的关键词。
                  要求：
                  1. 关键词应该是具体的技术术语、概念名称或主题词
                  2. 避免过于宽泛的词汇（如"学习"、"方法"等）
                  3. 优先选择能找到高质量技术文章的关键词
                  4. 输出格式必须是纯JSON数组：["关键词1", "关键词2", "关键词3"]
                  5. 除了JSON数组外，不要包含任何其他内容`
      },
      {
        role: 'user',
        content
      }
    ];

    const text = await deepSeekClient.chatCompletion(messages, {
      max_tokens: 200,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });
    console.log('🔍 关键词提取结果:', text);
    
    // 尝试解析 JSON
    let keywords: string[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        keywords = parsed;
      } else if (parsed.keywords && Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords;
      }
    } catch (parseError) {
      console.error('❌ 关键词解析失败，使用备用方案');
      // 备用方案：从原始内容中提取关键词
      keywords = extractKeywordsFromContent(content);
    }

    return keywords.slice(0, 4); // 最多返回4个关键词
  } catch (error: any) {
    console.error('❌ extractSearchKeywords 调用失败:', error.message || error);
    // 备用方案
    return extractKeywordsFromContent(content);
  }
}

/**
 * 备用关键词提取方案（基于简单规则）
 */
function extractKeywordsFromContent(content: string): string[] {
  // 简单的关键词提取逻辑
  const commonTechTerms = [
    'React', 'Vue', 'Angular', 'JavaScript', 'TypeScript', 'Node.js',
    'Python', 'Java', 'Go', 'Rust', 'Docker', 'Kubernetes',
    '机器学习', '深度学习', '人工智能', '数据分析', '算法',
    '前端', '后端', '全栈', '微服务', '云计算', '区块链'
  ];
  
  const foundTerms = commonTechTerms.filter(term => 
    content.toLowerCase().includes(term.toLowerCase())
  );
  
  return foundTerms.slice(0, 3);
}

/**
 * @deprecated 废弃：DeepSeek 聊天模型不适合生成向量，请使用 utils/embedding.ts 中的 generateQwenEmbedding
 */
export async function generateEmbedding(input: string): Promise<number[]> {
  console.warn('⚠️ 警告：正在调用已废弃的 generateEmbedding (DeepSeek)，请尽快迁移至 Qwen Embedding');
  return [];
}
