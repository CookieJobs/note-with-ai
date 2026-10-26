import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTopicInputs, normalizeTopicLabel, TOPIC_ALIAS_VERSION } from '../services/userNoteTopicInputs';

test('摘要或关键词在修订号不变时变化会改变指纹', () => {
  const original = buildTopicInputs({ revision: 4, title: '标题', content: '正文', summary: '摘要一', keywords: ['知识图谱'] });
  const changedSummary = buildTopicInputs({ revision: 4, title: '标题', content: '正文', summary: '摘要二', keywords: ['知识图谱'] });
  const changedKeyword = buildTopicInputs({ revision: 4, title: '标题', content: '正文', summary: '摘要一', keywords: ['向量检索'] });

  assert.notEqual(original.sourceFingerprint, changedSummary.sourceFingerprint);
  assert.notEqual(original.sourceFingerprint, changedKeyword.sourceFingerprint);
});

test('指纹和提示文本输入可确定性规范化', () => {
  const note = { revision: 2, title: ' 标题 ', content: ' 正文 ', contentText: ' 正文纯文本 ', summary: ' 摘要 ', keywords: [' 标签一 ', '标签二'] };
  const first = buildTopicInputs(note);
  const second = buildTopicInputs({ ...note });

  assert.deepEqual(first, second);
  assert.equal(first.promptText, '标题\n\n摘要\n\n正文纯文本');
  assert.match(first.sourceFingerprint, /^[a-f0-9]{64}$/);
});

test('模型输入最多为 3000 个 Unicode 码点', () => {
  const promptText = buildTopicInputs({
    revision: 1,
    title: '标题🧠',
    summary: '摘要🚀'.repeat(1_000),
    content: '正文🌱'.repeat(2_000),
    contentText: '纯文本📚'.repeat(2_000),
  }).promptText;

  assert.equal(Array.from(promptText).length, 3_000);
});

test('提示文本截断不截断完整来源指纹', () => {
  const prefix = '正文'.repeat(1_600);
  const first = buildTopicInputs({ revision: 1, content: `${prefix}甲` });
  const second = buildTopicInputs({ revision: 1, content: `${prefix}乙` });

  assert.equal(first.promptText, second.promptText);
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint);
});

test('现有关键词和摘要成为候选话题', () => {
  const built = buildTopicInputs({
    revision: 3,
    content: '正文',
    keywords: ['人工智能', '知识图谱', '人工智能'],
    summary: '记录了许多内容。主题：摘要主题、向量检索',
  });

  assert.deepEqual(built.candidateTopics, ['人工智能', '知识图谱', '摘要主题', '向量检索']);
  assert.equal(built.source, 'mixed');

  const proseOnly = buildTopicInputs({ revision: 3, content: '正文', summary: '这是一段没有明确话题标签的自然语言摘要。' });
  assert.deepEqual(proseOnly.candidateTopics, []);
  assert.equal(proseOnly.source, 'bounded_content');
});

test('AI 和人工智能规范化为同一个中文规范话题', () => {
  assert.equal(TOPIC_ALIAS_VERSION, '1');
  assert.equal(normalizeTopicLabel(' ＡＩ '), '人工智能');
  assert.equal(normalizeTopicLabel('人工智能'), '人工智能');
  assert.equal(normalizeTopicLabel('ÉCOLE'), 'école');
});

test('未知中文标签保持不同', () => {
  assert.notEqual(normalizeTopicLabel('机器学习'), normalizeTopicLabel('深度学习'));
});
