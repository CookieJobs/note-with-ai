'use client';

import { useState } from 'react';
import type { NoteRelationship } from '../types/relationships';

const KIND_LABELS: Record<NoteRelationship['kind'], string> = {
  continuation: '延续了之前的想法',
  contrast: '和过去的判断相反',
  change: '同一个困扰出现了变化',
  tension: '两条记录之间有张力',
  shared_origin: '它们似乎来自同一个起点',
};

type Feedback = 'helpful' | 'not_relevant' | 'hide_pair';

type RelationshipCardProps = {
  relationship: NoteRelationship;
  onOpenSource: (relationship: NoteRelationship) => void;
  onFeedback: (verdict: Feedback) => void;
  onContinueWriting: (relationship: NoteRelationship) => void;
  onStartChat: (relationship: NoteRelationship) => void;
  selectedFeedback?: Feedback;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN');
}

export default function RelationshipCard({ relationship, onOpenSource, onFeedback, onContinueWriting, onStartChat, selectedFeedback }: RelationshipCardProps) {
  const [feedback, setFeedback] = useState<Feedback | undefined>(selectedFeedback);
  const selectFeedback = (verdict: Feedback) => {
    setFeedback(verdict);
    onFeedback(verdict);
  };

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" aria-label="关系线索">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">{KIND_LABELS[relationship.kind]}</span>
        <span className="text-xs text-gray-400">{formatDate(relationship.candidate.occurredAt)}</span>
      </div>
      <h3 className="text-base font-semibold leading-6 text-gray-900">{relationship.headline}</h3>
      <p className="mt-2 text-sm leading-6 text-gray-600">{relationship.explanation}</p>
      <div className="mt-3 space-y-2">
        <blockquote className="rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700">
          <span className="mb-1 block text-xs text-gray-400">这条记录 · {formatDate(relationship.source.occurredAt)}</span>
          “<span>{relationship.source.excerpt}</span>”
        </blockquote>
        <blockquote className="rounded-xl bg-gray-50 p-3 text-sm leading-6 text-gray-700">
          <span className="mb-1 block text-xs text-gray-400">过去的记录 · {formatDate(relationship.candidate.occurredAt)}</span>
          “<span>{relationship.candidate.excerpt}</span>”
        </blockquote>
      </div>
      <details className="mt-3 text-sm text-gray-600">
        <summary className="cursor-pointer select-none py-2">为什么会看到这个？</summary>
        <p className="pb-2 leading-6">这两段原文都被保留下来，方便你自己判断它们是否真的有关。</p>
      </details>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-100" onClick={() => onOpenSource(relationship)}>看看原文</button>
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-100" onClick={() => onContinueWriting(relationship)}>继续写</button>
        <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-gray-700 hover:bg-gray-100" onClick={() => onStartChat(relationship)}>和 AI 聊聊</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 border-t border-gray-100 pt-2" aria-label="关系反馈">
        <button type="button" aria-pressed={feedback === 'helpful'} className="min-h-11 rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100" onClick={() => selectFeedback('helpful')}>有帮助</button>
        <button type="button" aria-pressed={feedback === 'not_relevant'} className="min-h-11 rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100" onClick={() => selectFeedback('not_relevant')}>不太相关</button>
        <button type="button" aria-pressed={feedback === 'hide_pair'} className="min-h-11 rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100" onClick={() => selectFeedback('hide_pair')}>以后别再关联这两条</button>
      </div>
    </article>
  );
}
