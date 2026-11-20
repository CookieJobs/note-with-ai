import { IMessage } from '../types';
import { chatRelatedNoteRecallService } from './chatRelatedNoteRecallService';
import { chatService } from './chatService';
import { noteDiscoveryConversationService } from './noteDiscoveryConversationService';
import { trackProductEventBestEffort } from './productEventService';

type SessionSnapshot = ReturnType<typeof chatService.formatSession>;

type StreamAndCommitInput = {
  userId: string;
  messages: IMessage[];
  sessionId?: string;
  requestId?: string;
  title?: string;
  sourceNoteId?: string;
  onChunk: (chunk: string) => boolean;
  onAborted?: () => Promise<void> | void;
};

type StreamAndCommitResult = {
  fullReply: string;
  session: SessionSnapshot;
};

const OPTIONAL_ENRICHMENT_TIMEOUT_MS = 3_000;

class ChatTurnCommitService {
  private getLastUserMessage(messages: IMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
        return message.content.trim();
      }
    }

    return '';
  }

  async streamAndCommit({
    userId,
    messages,
    sessionId,
    requestId,
    title,
    sourceNoteId,
    onChunk,
    onAborted,
  }: StreamAndCommitInput): Promise<StreamAndCommitResult> {
    if (sessionId && requestId) {
      const replay = await noteDiscoveryConversationService.replayExisting(userId, sessionId, requestId);
      if (replay) {
        if (!onChunk(replay.fullReply)) throw new Error('CHAT_STREAM_ABORTED');
        return { fullReply: replay.fullReply, session: chatService.formatSession(replay.session as any) };
      }
    }
    const prepared = await chatService.prepareTurn(userId, messages, sessionId, sourceNoteId);
    messages = prepared.messages;
    if (prepared.sourceMode === 'multi_note_discovery' && sessionId && prepared.sourceSnapshots) {
      const result = await noteDiscoveryConversationService.execute({ userId, chatId: sessionId, requestId,
        messages, sourceSnapshots: prepared.sourceSnapshots, baseVersion: prepared.baseVersion });
      if (!onChunk(result.fullReply)) {
        await onAborted?.();
        throw new Error('CHAT_STREAM_ABORTED');
      }
      return { fullReply: result.fullReply, session: chatService.formatSession(result.session as any) };
    }
    const stream = await chatService.streamChat(messages, userId, prepared.sourceSnapshot);
    let fullReply = '';
    let aborted = false;

    const stopStream = async () => {
      try {
        if (stream && typeof (stream as AsyncGenerator).return === 'function') {
          await (stream as AsyncGenerator).return('');
        }
      } catch {}
    };

    try {
      for await (const chunk of stream) {
        if (!onChunk(chunk)) {
          aborted = true;
          await stopStream();
          break;
        }

        fullReply += chunk;
      }
    } finally {
      if (aborted) {
        await onAborted?.();
      }
    }

    if (aborted) {
      return Promise.reject(new Error('CHAT_STREAM_ABORTED'));
    }

    const finalMessages: IMessage[] = [...messages, { role: 'assistant', content: fullReply,
      ...(prepared.sourceSnapshot ? { sourceSnapshot: prepared.sourceSnapshot } : {}),
    }];
    const userText = this.getLastUserMessage(messages);

    const enrichment = Promise.all([
      userText && fullReply.trim()
        ? chatService.summarizeTitle(userText, fullReply, userId).catch(() => title)
        : Promise.resolve(title),
      chatRelatedNoteRecallService.recallFromMessages({
        userId,
        messages: finalMessages,
      }).catch(() => undefined),
    ]);
    let enrichmentTimer: ReturnType<typeof setTimeout> | undefined;
    const enrichmentDeadline = new Promise<[string | undefined, unknown[] | undefined]>((resolve) => {
      enrichmentTimer = setTimeout(() => resolve([title, undefined]), OPTIONAL_ENRICHMENT_TIMEOUT_MS);
    });
    const [nextTitle, relatedNotes] = await Promise.race([enrichment, enrichmentDeadline]);
    if (enrichmentTimer) clearTimeout(enrichmentTimer);

    const savedSession = await chatService.saveSession(
      userId,
      sessionId,
      finalMessages,
      nextTitle || title,
      relatedNotes,
      { sourceNoteId: prepared.sourceNoteId, trustedSourceSnapshots: true },
    );
    trackProductEventBestEffort({ name: 'chat_turn_committed', userId, source: 'server', properties: {} });

    return {
      fullReply,
      session: chatService.formatSession(savedSession),
    };
  }
}

export const chatTurnCommitService = new ChatTurnCommitService();
