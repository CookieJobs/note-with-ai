import { logger } from '../utils/logger';
/*
Input: 待补充
Output: 待补充
Pos: 后端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/

const { MongoClient, ObjectId } = require('mongodb');

async function checkNoteEmbedding() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('noteWithAI');
    const collection = db.collection('notes');
    
    // Note: If you are using ObjectId, you need to import it and use new ObjectId('...')
    // If your _id is a string, you can use it directly.
    // Based on typical mongoose usage, it's likely an ObjectId, but let's try both or just ObjectId first if we can.
    // But since the user provided ID '692cfcf7aa101ac19cacade6' which looks like a hex string but let's be careful.
    // Wait, '692cfcf7aa101ac19cacade6' is 24 chars, valid for ObjectId.
    
    const noteId = '692cfcf7aa101ac19cacade6';
    let query;
    try {
        query = { _id: new ObjectId(noteId) };
    } catch (e) {
        logger.info("ID is not valid ObjectId, trying as string");
        query = { _id: noteId };
    }

    const note = await collection.findOne(query);

    if (note) {
      logger.info('Note found:');
      logger.info('_id:', note._id);
      logger.info('content:', note.content);
      logger.info('embedding exists:', !!note.embedding);
      if (note.embedding) {
          logger.info('embedding length:', note.embedding.length);
      } else {
          logger.info('embedding is null or undefined');
      }
    } else {
      logger.info('Note not found with ID:', noteId);
    }
  } catch (error) {
    logger.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkNoteEmbedding();
