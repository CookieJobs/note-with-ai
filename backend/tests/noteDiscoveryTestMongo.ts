import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

const testUri = process.env.NOTE_DISCOVERY_TEST_MONGO_URI;

export const noteDiscoveryMongoTestOptions = {
  skip: !testUri && 'Set NOTE_DISCOVERY_TEST_MONGO_URI to the isolated MongoDB test server',
};

export async function connectNoteDiscoveryTestMongo(suite: 'budget' | 'worker') {
  const uri = new URL(testUri!);
  assert.equal(uri.protocol, 'mongodb:');
  assert.equal(uri.host, '127.0.0.1:27028');
  assert.equal(uri.username + uri.password + uri.search + uri.hash, '');
  assert.match(uri.pathname, /^\/nwai_discovery_test_[a-z0-9_]+$/);
  const database = `nwai_discovery_test_task2_${suite}_${randomBytes(6).toString('hex')}`;
  uri.pathname = '/' + database;
  await mongoose.connect(uri.href, { serverSelectionTimeoutMS: 5_000 });
  assert.equal(mongoose.connection.name, database);
  return async () => {
    try {
      assert.equal(mongoose.connection.name, database);
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  };
}


export async function grantDiscoveryTestUser(userId: string) {
  const User = (await import('../models/User')).default;
  await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(userId) }, {
    $setOnInsert: { email: userId + '@discovery-fixture.invalid', isActive: true },
    $set: { noteDiscoveryAccess: true },
  }, { upsert: true });
}
