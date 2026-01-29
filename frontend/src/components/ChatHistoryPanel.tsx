/*
Input: 待补充
Output: 待补充
Pos: 前端 模块
Note: 一旦我被更新，务必更新我的开头注释，以及所属的文件夹的 README
*/
'use client';

import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
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
    <aside className="fixed top-[80px] left-0 bottom-0 w-[320px] flex flex-col border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 transition-all duration-300 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      <div className="flex items-center justify-between p-4 h-[60px]">
        <span className="flex items-center gap-2 font-semibold text-sm text-foreground">
          <MessageSquare className="h-4 w-4 text-primary" />
          聊天记录
        </span>
        <Button 
          onClick={onNewSession} 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
          title="新建对话"
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">新建对话</span>
        </Button>
      </div>
      
      <Separator />
      
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {isClient && sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="bg-muted/50 p-3 rounded-full mb-3">
                <MessageSquare className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground mb-1">暂无聊天记录</p>
              <p className="text-xs text-muted-foreground/60">开始新对话后会显示在这里</p>
            </div>
          ) : (
            isClient && sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={cn(
                  "group flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-lg cursor-pointer transition-all duration-200 border border-transparent",
                  session.id === currentSessionId 
                    ? "bg-primary/10 text-primary font-medium border-primary/5 shadow-sm" 
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <span className="truncate flex-1 select-none">{session.title}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100",
                    session.id === currentSessionId 
                      ? "hover:bg-primary/20 text-primary hover:text-primary" 
                      : "hover:bg-destructive/10 hover:text-destructive"
                  )}
                  onClick={(e) => onDeleteSession(e, session.id)}
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
    </aside>
  );
};

export default ChatHistoryPanel;