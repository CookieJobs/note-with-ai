'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatSession {
  id: string;
  _id?: string;
  title: string;
  messages: any[];
}

interface ChatHistoryPanelProps {
  sessions: ChatSession[];
  currentSessionId: string;
  isClient: boolean;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (e: React.MouseEvent, sessionId: string) => void;
}

const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  sessions,
  currentSessionId,
  isClient,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
}) => {
  return (
    <aside className="fixed top-[80px] left-0 bottom-0 w-[320px] flex flex-col border-r border-border/40 bg-background/95 backdrop-blur-xl z-20 transition-all duration-300 shadow-[2px_0_8px_rgba(0,0,0,0.02)]">
      {/* Header Area */}
      <div className="flex items-center justify-between px-4 h-14 shrink-0">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground/80 tracking-tight">
          <MessageSquare className="h-4 w-4 opacity-70" />
          历史记录
        </span>
        <Button 
          onClick={onNewSession} 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 rounded-md hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all duration-200"
          title="新建对话"
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">新建对话</span>
        </Button>
      </div>
      
      <div className="px-4 pb-2">
        <Separator className="bg-border/40" />
      </div>
      
      {/* List Area */}
      <ScrollArea className="flex-1 px-3 py-2">
        <div className="space-y-1 pb-4">
          {isClient && sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4 select-none">
              <div className="bg-muted/30 p-4 rounded-full mb-4 ring-1 ring-border/50">
                <MessageSquarePlus className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-muted-foreground mb-1.5">开启新话题</p>
              <p className="text-xs text-muted-foreground/50 max-w-[180px] leading-relaxed">
                点击右上角的 "+" 按钮开始一个新的对话
              </p>
            </div>
          ) : (
            isClient && sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={cn(
                  "group relative flex items-center justify-between gap-3 px-3 py-2.5 text-sm rounded-md cursor-pointer transition-all duration-200 border border-transparent select-none",
                  session.id === currentSessionId 
                    ? "bg-primary/10 text-primary font-medium border-primary/5 shadow-sm" 
                    : "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground hover:shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
                )}
              >
                {/* Active Indicator Line (Optional style preference) */}
                {session.id === currentSessionId && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] bg-primary rounded-r-full opacity-80" />
                )}

                <span className={cn(
                  "truncate flex-1 transition-colors",
                  session.id === currentSessionId ? "pl-1.5" : ""
                )}>
                  {session.title || "新对话"}
                </span>
                
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 focus:opacity-100",
                    session.id === currentSessionId 
                      ? "hover:bg-primary/20 text-primary hover:text-primary" 
                      : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(e, session.id);
                  }}
                  title="删除对话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">删除对话</span>
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      
      {/* Bottom Gradient/Fade (Optional aesthetic touch) */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background/80 to-transparent pointer-events-none" />
    </aside>
  );
};

export default ChatHistoryPanel;
