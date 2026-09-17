import { IMessage } from '../types';
import { chatRelatedNoteRecallService } from './chatRelatedNoteRecallService';
import { chatService } from './chatService';

type SessionSnapshot = ReturnType<typeof chatService.formatSession>;

type StreamAndCommitInput = {
  userId: string;
  messages: IMessage[];
  sessionId?: string;
  title?: string;
  onChunk: (chunk: string) => boolean;
  onAborted?: () => Promise<void> | void;
};

type StreamAndCommitResult = {
  fullReply: string;
  session: SessionSnapshot;
};

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
    title,
    onChunk,
    onAborted,
  }: StreamAndCommitInput): Promise<StreamAndCommitResult> {
    const stream = await chatService.streamChat(messages);
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

    const finalMessages: IMessage[] = [...messages, { role: 'assistant', content: fullReply }];
    const userText = this.getLastUserMessage(messages);

    const [nextTitle, relatedNotes] = await Promise.all([
      userText && fullReply.trim()
        ? chatService.summarizeTitle(userText, fullReply).catch(() => title)
        : Promise.resolve(title),
      chatRelatedNoteRecallService.recallFromMessages({
        userId,
        messages: finalMessages,
      }).catch(() => []),
    ]);

    const savedSession = await chatService.saveSession(
      userId,
      sessionId,
      finalMessages,
      nextTitle || title,
      relatedNotes,
    );

    return {
      fullReply,
      session: chatService.formatSession(savedSession),
    };
  }
}

export const chatTurnCommitService = new ChatTurnCommitService();
