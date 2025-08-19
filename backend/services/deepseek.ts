// backend/services/deepseek.ts
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';

/**
 * 与 DeepSeek 聊天模型对话
 */
export async function chatWithDeepSeek(messages: { role: 'user' | 'assistant' | 'system'; content: string }[]): Promise<string> {
  try {
    const response = await axios.post(
      CHAT_URL,
      {
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 1024,
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error('未收到模型回复');
    }
    return reply;
  } catch (error: any) {
    console.error('❌ chatWithDeepSeek 调用失败:', error.message || error);
    // 抛出错误而不是返回错误字符串
    throw new Error(`DeepSeek API 调用失败: ${error.message || error}`);
  }
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
    const response = await axios.post(
      CHAT_URL,
      {
        model: 'deepseek-chat',
        messages,
        max_tokens: 50,
        temperature: 0.1,
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const title = response.data.choices[0].message.content.trim();
    return title || '未命名对话';
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
  
      const response = await axios.post(
        CHAT_URL,
        {
          model: 'deepseek-chat',
          messages,
          max_tokens: 500,
          temperature: 0.1,
          response_format: { type: 'json_object' }, // 明确要求返回 JSON
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
  
      const text = response.data.choices[0].message.content;
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

    const response = await axios.post(
      CHAT_URL,
      {
        model: 'deepseek-chat',
        messages,
        max_tokens: 200,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        stream: false
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const text = response.data.choices[0].message.content;
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
 * 可选：单独提供向量生成逻辑用于延迟处理或后台任务
 */
export async function generateEmbedding(input: string): Promise<number[]> {
  try {
    const messages = [
      {
        role: 'system',
        content: '你是一个嵌入助手。用户会提供一段文本，请你返回一个表示该文本语义的 1536 维向量数组（只包含数字）。请确保你的回复只包含数组本身，格式为 JSON 数组，例如：[0.123, -0.456, ...]。不要添加任何解释说明。'
      },
      {
        role: 'user',
        content: input
      }
    ];

    const response = await axios.post(
      CHAT_URL,
      {
        model: 'deepseek-reasoner',
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reasoningContent = response.data.choices[0].message.reasoning_content;

    const vector = JSON.parse(reasoningContent);
    if (Array.isArray(vector) && typeof vector[0] === 'number') {
      return vector;
    } else {
      console.warn('嵌入向量格式异常，返回空数组');
      return [];
    }
  } catch (error) {
    console.error('Embedding via chat error:', error);
    return [];
  }
}
