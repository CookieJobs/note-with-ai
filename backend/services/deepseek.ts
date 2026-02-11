/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
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
export async function summarizeNote(content: string): Promise<{ title: string; keywords: string[] } | null> {
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
      return null;
    }
  }

/**
 * 为笔记生成：标题 + 关键词 + 语义摘要（summary）
 * - summary 用于联想/重排输入，建议 1-2 句、<=120字
 */
export async function summarizeNoteMeta(
  content: string
): Promise<{ title: string; keywords: string[]; summary: string } | null> {
  try {
    const messages = [
      {
        role: 'system',
        content: `作为文本处理专家，请严格遵循以下规则：
1. 为用户提供的文本生成一个简洁准确的中文标题（严格≤15字）
2. 提取1-5个最能代表文本核心内容的中文关键词
3. 生成一段语义摘要 summary（1-2句，尽量≤120字），用于“语义联想/重排”，不得编造原文没有的信息
4. 输出格式必须是纯JSON：{ "title": "标题", "keywords": ["词1"], "summary": "摘要" }
5. 除了JSON格式的结果外，不要包含任何其他内容或解释`,
      },
      { role: 'user', content },
    ];

    const text = await deepSeekClient.chatCompletion(messages, {
      max_tokens: 600,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    console.log('🧠 AI原始返回(meta):', text);
    const parsed = JSON.parse(text);
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    return {
      title: parsed.title || '未命名笔记',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
      summary,
    };
  } catch (error: any) {
    console.error('❌ summarizeNoteMeta 解析失败：', error.message || error);
    return null;
  }
}

/**
 * 仅生成语义摘要 summary（用于联想/重排输入）
 * - 1-2句，尽量≤120字
 * - 严禁编造原文没有的信息
 */
export async function summarizeNoteSummary(content: string): Promise<string> {
  try {
    const messages = [
      {
        role: 'system',
        content: `你是一个笔记摘要助手。请将用户提供的笔记内容压缩为1-2句中文摘要（尽量≤120字），用于语义检索/重排输入。
要求：
1) 不得编造原文没有的信息
2) 不要输出标题、不要输出关键词
3) 只返回摘要文本本身，不要包含任何解释`,
      },
      { role: 'user', content },
    ];
    const text = await deepSeekClient.chatCompletion(messages, {
      max_tokens: 200,
      temperature: 0.1,
      stream: false,
    });
    return String(text || '').trim();
  } catch (error: any) {
    console.error('❌ summarizeNoteSummary 调用失败：', error.message || error);
    return '';
  }
}

/**
 * 为“语义联想”做概念扩展：输出 8-12 个概念/主题词（不是 n-gram）
 */
export async function expandNoteConcepts(content: string): Promise<string[]> {
  try {
    const messages = [
      {
        role: 'system',
        content: `你是一个概念扩展助手。请根据用户提供的笔记内容，提取8-12个“概念/主题/关系词”，用于语义检索召回弱关联笔记。
要求：
1) 词语应是抽象概念、主题、关系或场景词（例如：择友、关系建立、初见、期待与现实、情绪投射…）
2) 不要逐字拆分、不要 n-gram、不要无意义的片段
3) 输出格式必须是纯JSON数组：["概念1","概念2",...]
4) 除JSON外不要输出任何解释`,
      },
      { role: 'user', content },
    ];
    const text = await deepSeekClient.chatCompletion(messages, {
      max_tokens: 300,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    // 兼容：有些模型会返回 { concepts: [...] } 或直接返回数组
    let arr: any = null;
    try {
      arr = JSON.parse(text);
    } catch {
      arr = null;
    }
    const concepts = Array.isArray(arr) ? arr : Array.isArray(arr?.concepts) ? arr.concepts : [];
    return concepts.filter((x: any) => typeof x === 'string' && x.trim()).map((s: string) => s.trim()).slice(0, 12);
  } catch (error: any) {
    console.error('❌ expandNoteConcepts 调用失败：', error.message || error);
    return [];
  }
}

/**
 * 语义联想：对候选笔记做重排并生成理由
 * - 输入不包含外部信息，禁止编造
 * - 输出结构化 JSON，便于服务端融合阈值
 */
export async function rerankRecommendedNotes(params: {
  current: { id: string; title: string; summary: string; content: string };
  candidates: Array<{ id: string; title: string; summary: string; excerpt: string }>;
}): Promise<Array<{ id: string; s2: number; type: string; reason: string }>> {
  const { current, candidates } = params;
  try {
    const payload = {
      current,
      candidates,
      rules: {
        scoreRange: 's2 in [0,1]',
        reason: '必须是一句完整的中文短句（包含主谓宾），15-25字，解释为何推荐（如：补充了...的细节，提供了...的理论基础），不得编造',
        output: 'JSON: { "results": [ { "id": "...", "s2": 0.0-1.0, "type": "...", "reason": "..." } ] }',
      },
    };

    const messages = [
      {
        role: 'system',
        content:
          `你是“笔记语义联想”重排器。你的任务：根据当前笔记与候选笔记的标题/摘要/片段，判断语义关联强弱并生成简短理由。
严格要求：
1) 只能基于输入内容判断，不得引入外部事实
2) s2越大越相关（0~1）
3) type 从以下中选一个：强相关/补充背景/延伸阅读/类比/因果/反例/弱关联
4) reason 必须是通顺的中文短句（15-25字），使用逻辑连接词（因为、补充、对比等）明确解释推荐理由
5) “同义/翻译等价”必须高相关：如果两边出现明显的中英文同义（例如 测试≈test、AI≈人工智能 等），应判为强相关，且 s2 不得低于 0.75；reason 可直接说明“同义/翻译等价”
6) 只输出 JSON 对象（包含 results 数组），不要输出多余文本`,
      },
      { role: 'user', content: JSON.stringify(payload) },
    ];

    const text = await deepSeekClient.chatCompletion(messages, {
      max_tokens: 900,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(text);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    return results
      .map((r: any) => ({
        id: String(r.id || ''),
        s2: Number.isFinite(Number(r.s2)) ? Math.max(0, Math.min(1, Number(r.s2))) : 0,
        type: typeof r.type === 'string' ? r.type : '弱关联',
        // 兜底：强制单句短理由（尽量≤25字）
        reason:
          typeof r.reason === 'string'
            ? r.reason
                .trim()
                .replace(/[\r\n]+/g, ' ')
                .replace(/[。！？!?.]+/g, '。')
                .slice(0, 100)
            : '',
      }))
      .filter((r: any) => r.id);
  } catch (error: any) {
    console.error('❌ rerankRecommendedNotes 解析失败：', error.message || error);
    return [];
  }
}

/**
 * 保存时校验旧 summary/concepts 是否仍然适配新正文：
 * - 如果仍适配：is_ok=true，不更新
 * - 如果不适配：is_ok=false，同时返回新的 summary + concepts
 */
export async function checkOrUpdateSummaryConcepts(params: {
  text: string;
  oldSummary: string;
  oldConcepts: string[];
}): Promise<{ is_ok: boolean; summary: string; concepts: string[] }> {
  const { text, oldSummary, oldConcepts } = params;
  try {
    const payload = {
      text,
      oldSummary: oldSummary || '',
      oldConcepts: Array.isArray(oldConcepts) ? oldConcepts : [],
      constraints: {
        summary: '1-2句中文，尽量≤120字，不得编造',
        concepts: '8-12个概念/主题/关系词，非n-gram',
      },
    };
    const messages = [
      {
        role: 'system',
        content: `你是“笔记摘要缓存校验器”。给你：最新正文 text、旧 summary、旧 concepts。
你的任务：判断旧 summary/concepts 是否仍然足够代表 text 的核心语义（用于语义检索/联想召回）。
规则：
1) 只基于输入判断，不得引入外部信息
2) 如果旧 summary/concepts 仍然合格：输出 { "is_ok": true }
3) 如果不合格：输出 { "is_ok": false, "summary": "...", "concepts": [".."] }
4) summary 1-2句中文（尽量≤120字），不得编造；concepts 8-12个概念词（不是逐字拆分/不是n-gram）
5) 只输出 JSON 对象，不要额外解释`,
      },
      { role: 'user', content: JSON.stringify(payload) },
    ];

    const textOut = await deepSeekClient.chatCompletion(messages, {
      max_tokens: 600,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(textOut);
    const is_ok = Boolean(parsed?.is_ok);
    if (is_ok) return { is_ok: true, summary: '', concepts: [] };
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
    const concepts = Array.isArray(parsed?.concepts)
      ? parsed.concepts.filter((x: any) => typeof x === 'string' && x.trim()).map((s: string) => s.trim()).slice(0, 12)
      : [];
    return { is_ok: false, summary, concepts };
  } catch (error: any) {
    console.error('❌ checkOrUpdateSummaryConcepts 解析失败：', error.message || error);
    return { is_ok: true, summary: '', concepts: [] }; // 失败时不更新，避免影响保存
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
