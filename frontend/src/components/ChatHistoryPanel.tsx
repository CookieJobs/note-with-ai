'use client';

import React from 'react';
import { Plus, Trash2, MessageSquarePlus } from 'lucide-react';

import { useIsBreakpoint } from '@/hooks/use-is-breakpoint';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTitle, DrawerContent } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { IChat } from '../types';

interface ChatHistoryPanelProps {
  sessions: IChat[];
  currentSessionId: string;
  isClient: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
}

interface HistoryListProps extends Pick<
  ChatHistoryPanelProps,
  'sessions' | 'currentSessionId' | 'isClient' | 'onSessionSelect' | 'onNewSession' | 'onDeleteSession'
> {
  onDismiss: () => void;
}

function HistoryList({
  sessions,
  currentSessionId,
  isClient,
  onDismiss,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
}: HistoryListProps) {
  const selectSession = (sessionId: string) => {
    onSessionSelect(sessionId);
    onDismiss();
  };

  const createSession = () => {
    onNewSession();
    onDismiss();
  };

  return (
    <>
      <div className="flex flex-col gap-3 px-4 py-4 shrink-0">
        <Button
          type="button"
          onClick={createSession}
          variant="ghost"
          className="min-h-11 w-full justify-start gap-2 px-2 text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="font-medium">开启新对话</span>
        </Button>
        <p className="px-1 text-xs font-medium text-muted-foreground tracking-wider uppercase">
          你的聊天
        </p>
      </div>

      <nav aria-label="聊天会话" className="flex-1 min-h-0">
        <ScrollArea className="h-full px-3 py-2">
          {!isClient || sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4 select-none">
              <div className="bg-muted/30 p-4 rounded-full mb-4 ring-1 ring-border/50">
                <MessageSquarePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-muted-foreground mb-1.5">开启新话题</p>
              <p className="text-xs text-muted-foreground max-w-[180px] leading-relaxed">
                点击右上角的 &quot;+&quot; 按钮开始一个新的对话
              </p>
            </div>
          ) : (
            <ul className="space-y-1 pb-4" aria-label="聊天会话列表">
              {sessions.map((session) => {
                const title = session.title || '新对话';
                const isCurrent = session.id === currentSessionId;

                return (
                  <li
                    key={session.id}
                    className={cn(
                      'group flex items-center gap-1 rounded-md border border-transparent',
                      isCurrent ? 'bg-primary/10' : 'hover:bg-muted/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectSession(session.id)}
                      aria-current={isCurrent ? 'page' : undefined}
                      className="min-h-11 flex-1 min-w-0 rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="block truncate">{title}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`删除对话：${title}`}
                      className={cn(
                        'min-h-11 min-w-11 shrink-0 text-muted-foreground hover:text-destructive',
                        isCurrent ? 'hover:bg-primary/20' : 'hover:bg-destructive/10',
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteSession(event, session.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </nav>
    </>
  );
}

const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = (props) => {
  const isDesktop = useIsBreakpoint('min', 768);
  const historyProps = {
    sessions: props.sessions,
    currentSessionId: props.currentSessionId,
    isClient: props.isClient,
    onSessionSelect: props.onSessionSelect,
    onNewSession: props.onNewSession,
    onDeleteSession: props.onDeleteSession,
  };

  if (isDesktop) {
    return (
      <aside
        aria-label="聊天记录"
        className="flex w-left-panel xl:w-left-panel-xl shrink-0 flex-col overflow-hidden rounded-2xl border border-border/20 bg-card/80 shadow-md backdrop-blur-xl"
      >
        <h2 className="px-4 pt-4 text-lg font-semibold text-foreground">聊天记录</h2>
        <HistoryList {...historyProps} onDismiss={props.onClose} />
      </aside>
    );
  }

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DrawerContent
        aria-describedby={undefined}
        className="w-[min(100%,24rem)] max-w-[calc(100%-1rem)] gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="px-4 pt-4 text-lg font-semibold">聊天记录</DialogTitle>
        <HistoryList {...historyProps} onDismiss={props.onClose} />
      </DrawerContent>
    </Dialog>
  );
};

export default ChatHistoryPanel;
