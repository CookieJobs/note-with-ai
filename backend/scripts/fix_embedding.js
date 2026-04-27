import { logger } from '../utils/logger';
/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/

const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

// 加载 .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'qwen3-vl-embedding';

function isMultimodalModel(modelName) {
  return modelName.includes('-vl-') || modelName.includes('vision');
}

async function generateQwenEmbedding(text) {
  try {
    if (!DASHSCOPE_API_KEY) {
      throw new Error('DASHSCOPE_API_KEY 环境变量未设置');
    }

    const isMultimodal = isMultimodalModel(EMBEDDING_MODEL);
    const url = isMultimodal 
      ? 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
      : 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';

    let requestBody;
    if (isMultimodal) {
      requestBody = {
        model: EMBEDDING_MODEL,
        input: {
          contents: [{ text }]
        },
        parameters: { dimension: 1024 }
      };
    } else {
      requestBody = {
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: 1024,
        encoding_format: 'float'
      };
    }

    const response = await axios.post(
      url,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000 
      }
    );

    if (isMultimodal) {
      return response.data.output.embeddings[0].embedding;
    } else {
      return response.data.data[0].embedding;
    }
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message || error;
    logger.error(`❌ Qwen Embedding 生成失败 (${EMBEDDING_MODEL}):`, errorMsg);
    return [];
  }
}

async function fixNoteEmbedding() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('noteWithAI');
    const collection = db.collection('notes');
    
    const noteId = '692cfcf7aa101ac19cacade6';
    let query;
    try {
        query = { _id: new ObjectId(noteId) };
    } catch (e) {
        query = { _id: noteId };
    }

    const note = await collection.findOne(query);

    if (note) {
      logger.info('📝 找到笔记:', note._id);
      
      if (!note.embedding || note.embedding.length === 0) {
          logger.info('⚙️ 正在生成 Embedding...');
          const embedding = await generateQwenEmbedding(note.content);
          
          if (embedding.length > 0) {
              await collection.updateOne(query, { $set: { embedding: embedding } });
              logger.info('✅ Embedding 修复成功，长度:', embedding.length);
          } else {
              logger.error('❌ 生成的 Embedding 为空，修复失败');
          }
      } else {
          logger.info('✅ Embedding 已存在且不为空，无需修复');
      }
    } else {
      logger.info('❌ 未找到指定 ID 的笔记');
    }
  } catch (error) {
    logger.error('❌ 脚本执行出错:', error);
  } finally {
    await client.close();
  }
}

fixNoteEmbedding();
