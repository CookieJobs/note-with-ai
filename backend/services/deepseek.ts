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
    return reply || '（未收到模型回复）';
  } catch (error: any) {
    console.error('❌ chatWithDeepSeek 调用失败:', error.message || error);
    return '（AI 响应失败）';
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
