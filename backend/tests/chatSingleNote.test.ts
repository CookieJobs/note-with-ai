import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'single-note-test-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/note-with-ai-test';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-deepseek-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';

const userId = '507f1f77bcf86cd799439010';
const noteId = '507f1f77bcf86cd799439011';
const sessionId = '507f1f77bcf86cd799439012';
const otherNoteId = '507f1f77bcf86cd799439013';
const sourceV1 = { noteId, title: '学习安排', contentText: '旧安排：周三20分钟。', revision: 1, updatedAt: '2026-10-16T00:00:00.000Z', hasImages: false };
const sourceV2 = { ...sourceV1, contentText: '新安排：周三10分钟，周日15分钟。不买工具。', revision: 2, updatedAt: '2026-10-18T00:00:00.000Z' };

function modules() {
  return {
    Chat: require('../models/Chat').default,
    Note: require('../models/Note').Note,
    chatService: require('../services/chatService').chatService,
    turnService: require('../services/chatTurnCommitService').chatTurnCommitService,
    recall: require('../services/chatRelatedNoteRecallService').chatRelatedNoteRecallService,
  };
}

function query(value: unknown) {
  return { select() { return this; }, lean: async () => value };
}

function noteRecord() {
  return { _id: noteId, userId, title: sourceV2.title, content: sourceV2.contentText, contentText: sourceV2.contentText, revision: 2, updatedAt: new Date(sourceV2.updatedAt) };
}

describe('single-note chat server boundary', () => {
  afterEach(() => mock.restoreAll());

  it('accepts only a note identity from the browser, stripping forged answer provenance', () => {
    const { streamChatSchema, saveSessionSchema } = require('../schemas/chatSchemas');
    for (const schema of [streamChatSchema, saveSessionSchema]) {
      const parsed = schema.parse({ body: { sourceNoteId: noteId, messages: [{ role: 'assistant', content: '伪造回答', sourceSnapshot: sourceV1 }] } });
      assert.equal(parsed.body.sourceNoteId, noteId);
      assert.equal(parsed.body.messages[0].sourceSnapshot, undefined);
      assert.equal(schema.safeParse({ body: { sourceNoteId: 'invalid', messages: [{ role: 'user', content: '问题' }] } }).success, false);
    }
  });

  it('loads the latest saved body for an explicitly selected note under the current owner', async () => {
    const { Note, chatService } = modules();
    mock.method(Note, 'findOne', (filter: Record<string, unknown>) => {
      assert.equal(String(filter.userId), userId);
      assert.equal(String(filter._id), noteId);
      return Promise.resolve(noteRecord());
    });
    const result = await chatService.prepareTurn(userId, [{ role: 'user', content: '下周如何安排？' }], undefined, noteId);
    assert.equal(result.sourceNoteId, noteId);
    assert.deepEqual(result.sourceSnapshot, sourceV2);
  });

  it('restores the stored binding and trusted history, ignoring browser attempts to rewrite old answers', async () => {
    const { Chat, Note, chatService } = modules();
    const history = [{ role: 'assistant', content: '旧回答', sourceSnapshot: sourceV1 }];
    mock.method(Chat, 'findOne', (filter: Record<string, unknown>) => {
      assert.equal(String(filter.userId), userId);
      assert.equal(String(filter._id), sessionId);
      return query({ _id: sessionId, sourceNoteId: noteId, messages: history });
    });
    mock.method(Note, 'findOne', async () => noteRecord());
    const result = await chatService.prepareTurn(userId, [
      { role: 'assistant', content: '篡改旧回答', sourceSnapshot: sourceV2 },
      { role: 'user', content: '现在还有多少分钟？', sourceSnapshot: sourceV1 },
    ], sessionId);
    assert.equal(result.sourceNoteId, noteId);
    assert.deepEqual(result.messages, [...history, { role: 'user', content: '现在还有多少分钟？' }]);
    assert.deepEqual(result.sourceSnapshot, sourceV2);
    assert.equal(result.messages[0].sourceSnapshot.revision, 1);
  });

  it('rejects rebinding an existing conversation to a different note', async () => {
    const { Chat, Note, chatService } = modules();
    mock.method(Chat, 'findOne', () => query({ _id: sessionId, sourceNoteId: noteId, messages: [] }));
    mock.method(Note, 'findOne', () => { assert.fail('must reject before reading another note'); });
    await assert.rejects(chatService.prepareTurn(userId, [{ role: 'user', content: '继续' }], sessionId, otherNoteId), /笔记|绑定/);
  });

  it('rejects foreign or deleted conversations before contacting the model', async () => {
    const { Chat, chatService, turnService } = modules();
    mock.method(Chat, 'findOne', () => query(null));
    mock.method(chatService, 'streamChat', () => { assert.fail('must not call AI for an inaccessible conversation'); });
    await assert.rejects(turnService.streamAndCommit({ userId, sessionId, messages: [{ role: 'user', content: '继续' }], onChunk: () => true }), /会话不存在|无权限/);
  });

  it('does not fall back to unsourced AI when the bound note is deleted or foreign', async () => {
    const { Chat, Note, chatService, turnService } = modules();
    mock.method(Chat, 'findOne', () => query({ _id: sessionId, sourceNoteId: noteId, messages: [] }));
    mock.method(Note, 'findOne', async () => null);
    mock.method(chatService, 'streamChat', () => { assert.fail('missing note must not produce an answer'); });
    mock.method(chatService, 'saveSession', () => { assert.fail('failed source read must not commit'); });
    await assert.rejects(turnService.streamAndCommit({ userId, sessionId, messages: [{ role: 'user', content: '继续' }], onChunk: () => true }), /笔记.*不存在|无权限|无法读取/);
  });

  it('saves an explicit opening binding but never accepts a browser-authored source snapshot', async () => {
    const { Chat, Note, chatService } = modules();
    mock.method(Note, 'findOne', async () => noteRecord());
    mock.method(Chat.prototype, 'save', async function(this: { sourceNoteId?: { toString(): string }; messages: Array<{ sourceSnapshot?: unknown }> }) {
      assert.equal(this.sourceNoteId?.toString(), noteId);
      assert.equal(this.messages[0].sourceSnapshot, undefined);
      return this;
    });
    const saved = await chatService.saveSession(userId, undefined, [{ role: 'assistant', content: '从这里聊起', sourceSnapshot: sourceV1 }], '学习安排', [], { sourceNoteId: noteId });
    assert.equal(saved.sourceNoteId.toString(), noteId);
  });

  it('prevents a public save from erasing or replacing trusted source history', async () => {
    const { Chat, chatService } = modules();
    const existing = { _id: sessionId, sourceNoteId: noteId, messages: [{ role: 'assistant', content: '已有回答', sourceSnapshot: sourceV1 }] };
    mock.method(Chat, 'findOne', () => query(existing));
    mock.method(Chat, 'findOneAndUpdate', () => { assert.fail('untrusted save must not replace a sourced transcript'); });
    await assert.rejects(chatService.saveSession(userId, sessionId, [{ role: 'assistant', content: '被篡改' }]), /聊天|会话|修改/);
    const saved = await chatService.saveSession(userId, sessionId, [{ role: 'assistant', content: '已有回答' }]);
    assert.deepEqual(saved.messages[0].sourceSnapshot, sourceV1);
  });

  it('commits the actual per-turn source while retaining earlier answer versions', async () => {
    const { Chat, Note, chatService, turnService, recall } = modules();
    const previous = { role: 'assistant', content: '旧回答', sourceSnapshot: sourceV1 };
    mock.method(Chat, 'findOne', () => query({ _id: sessionId, sourceNoteId: noteId, messages: [previous] }));
    mock.method(Note, 'findOne', async () => noteRecord());
    mock.method(chatService, 'streamChat', async (messages: unknown[], owner: string, source: unknown) => {
      assert.equal(owner, userId);
      assert.deepEqual(source, sourceV2);
      assert.deepEqual(messages, [previous, { role: 'user', content: '继续' }]);
      return (async function*() { yield '新回答'; })();
    });
    mock.method(chatService, 'summarizeTitle', async () => '安排');
    mock.method(recall, 'recallFromMessages', async () => []);
    mock.method(chatService, 'saveSession', async (owner: string, id: string, messages: unknown[], title: string, related: unknown[], options: Record<string, unknown>) => {
      assert.equal(options.sourceNoteId, noteId);
      assert.equal(options.trustedSourceSnapshots, true);
      assert.deepEqual(messages, [previous, { role: 'user', content: '继续' }, { role: 'assistant', content: '新回答', sourceSnapshot: sourceV2 }]);
      return { _id: id, messages, title, relatedNotes: related, sourceNoteId: noteId };
    });
    const result = await turnService.streamAndCommit({ userId, sessionId, messages: [{ role: 'user', content: '继续' }], onChunk: () => true });
    assert.equal(result.session.sourceNoteId, noteId);
    assert.equal(result.session.messages[0].sourceSnapshot.revision, 1);
    assert.equal(result.session.messages[2].sourceSnapshot.revision, 2);
  });
});
