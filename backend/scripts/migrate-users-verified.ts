import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const result = await mongoose.connection.db!
    .collection('users')
    .updateMany(
      { isVerified: { $exists: false } },
      { $set: { isVerified: true } }
    );

  console.log(`Migrated ${result.modifiedCount} existing users (isVerified: true)`);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
