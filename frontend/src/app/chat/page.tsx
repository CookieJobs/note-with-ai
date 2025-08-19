'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
// import Sidebar from '../../components/Sidebar';
// import MobileMenuButton from '../../components/MobileMenuButton';
import ChatMessage from '../../components/ChatMessage';
import styles from './chat.module.scss';
import { isAuthenticated, getUser, authFetch } from '../../utils/auth';
import TopNavigation from '../../components/TopNavigation';

interface RelatedNote {
  id: string;
  title: string;
  content: string;
  similarity: number;
  matchType: string;
  createdAt: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  relatedNotes?: RelatedNote[];
  searchingNotes?: boolean;
}

interface ChatSession {
  id: string;
  _id?: string; // MongoDB 返回的 _id 字段
  title: string;
  messages: Message[];
}

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isClient, setIsClient] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string>('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 确保只在客户端渲染
  useEffect(() => {
    setIsClient(true);
  }, []);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const messages = currentSession?.messages || [];

  // 检查用户认证状态
  useEffect(() => {
    if (!isClient) return;
    
    if (!isAuthenticated()) {
      router.push('/auth');
      return;
    }
    
    const userData = getUser();
    if (userData) {
      setUser(userData);
    } else {
      router.push('/auth');
    }
  }, [isClient, router]);

  // 获取本地存储 & 请求服务器记录
  useEffect(() => {
    if (!user?.id || !isClient) return;
    console.log('🟠 useEffect[user] 触发, userId:', user.id);
    const storageKey = `chat_sessions_${user.id}`;
    const local = localStorage.getItem(storageKey);
    const parsed: ChatSession[] = local ? JSON.parse(local) : [];
    console.log('🟠 useEffect[user] 本地 parsed:', parsed);
    
    // 只有在没有会话或当前没有选中会话时，才设置默认选中的会话
    if (sessions.length === 0) {
      setSessions(parsed);
      if (!currentSessionId && parsed.length > 0) {
        console.log('🟠 设置默认选中的会话:', parsed[0]?.id);
        setCurrentSessionId(parsed[0]?.id || '');
      }
    }

    // 如果当前正在创建新会话，则不加载服务器会话
    if (currentSessionId && currentSessionId.startsWith('local_')) {
      console.log('🟠 检测到正在创建新会话，跳过加载服务器会话');
      return;
    }
    
    // 添加防抖，避免频繁加载服务器会话
    const timer = setTimeout(() => {
      console.log('🟠 延迟加载服务器会话');
      loadSessionsFromDB(user.id, parsed);
    }, 1000); // 延迟1秒加载
    
    return () => clearTimeout(timer); // 清除定时器
  }, [user?.id, isClient]); // 移除currentSessionId依赖，避免频繁触发

  // 添加调试日志，帮助排查问题
  useEffect(() => {
    if (!isClient) return;
    console.log('🔍 当前sessions:', sessions);
    console.log('🔍 当前currentSessionId:', currentSessionId);
  }, [sessions, currentSessionId, isClient]);

  const loadSessionsFromDB = async (userId: string, localSessions: ChatSession[]) => {
    try {
      const res = await authFetch('/api/chat/list');
      const data = await res.json();
      console.log('🟣 loadSessionsFromDB 服务端 data.sessions:', data.sessions);
      if (data.sessions && data.sessions.length > 0) {
        // 服务器数据优先，过滤掉本地重复会话
        const serverSessionIds = new Set(data.sessions.map((s: ChatSession) => s.id || s._id));
        // 过滤掉本地会话中与服务器重复的会话，并且过滤掉本地无效会话（如空消息会话）
        const filteredLocal = localSessions.filter(s => !serverSessionIds.has(s.id) && !serverSessionIds.has(s._id) && s.messages.length > 0);
        const combined = [...data.sessions, ...filteredLocal];
        // 去重合并后的会话，防止重复
        const uniqueSessionsMap = new Map<string, ChatSession>();
        combined.forEach(session => {
          const id = session.id || session._id;
          if (!uniqueSessionsMap.has(id)) {
            uniqueSessionsMap.set(id, session);
          }
        });
        const uniqueSessions = Array.from(uniqueSessionsMap.values());
        console.log('🟣 loadSessionsFromDB 合并后的 uniqueSessions:', uniqueSessions);
        
        // 保存当前会话ID
        const currentId = currentSessionId;
        console.log('🟣 loadSessionsFromDB 更新前的 currentSessionId:', currentId);
        
        // 如果当前正在创建新会话，则不更新会话列表
        if (currentId && currentId.startsWith('local_')) {
          console.log('🟣 loadSessionsFromDB 检测到正在创建新会话，跳过更新会话列表');
          return;
        }
        
        // 保留当前会话的消息内容
        let currentSessionMessages: Message[] = [];
        if (currentId) {
          const currentSession = sessions.find(s => s.id === currentId);
          if (currentSession) {
            currentSessionMessages = currentSession.messages;
          }
        }
        
        // 更新会话列表，但保留当前会话的消息内容
        setSessions(prevSessions => {
          // 如果有当前会话，确保保留其消息内容
          const updatedSessions = uniqueSessions.map(s => {
            if (s.id === currentId || s._id === currentId) {
              return { ...s, messages: currentSessionMessages.length > 0 ? currentSessionMessages : s.messages };
            }
            return s;
          });
          
          // 更新本地存储
          localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updatedSessions));
          
          return updatedSessions;
        });
        
        // 如果当前没有选中的会话，或者当前选中的会话不在新的会话列表中，才设置为第一个会话
        if (!currentId || !uniqueSessions.some(s => (s.id === currentId || s._id === currentId))) {
          const newCurrentId = uniqueSessions[0]?.id || uniqueSessions[0]?._id || '';
          console.log('🟣 loadSessionsFromDB 设置新的 currentSessionId:', newCurrentId);
          setCurrentSessionId(newCurrentId);
        } else {
          console.log('🟣 loadSessionsFromDB 保持当前 currentSessionId:', currentId);
        }
      }
    } catch (err) {
      console.error('❌ 获取聊天记录失败:', err);
    }
  };

  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const startNewSession = async () => {
    if (!user?.id) return;
    
    // 使用本地ID前缀，以便识别正在创建的新会话
    const localId = `local_${generateUUID()}`;
    console.log('🔵 startNewSession 生成本地ID:', localId);
    
    const newSession: ChatSession = {
      id: localId,
      title: '新对话',
      messages: [],
    };
    
    // 先在本地更新会话状态
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(localId);
    console.log('🔵 startNewSession 设置 currentSessionId:', localId);
    
    // 保存到数据库
    try {
      const savedId = await saveSessionToDB(user.id, newSession);
      console.log('🔵 startNewSession 保存到数据库后返回的ID:', savedId);
      
      // 如果服务器返回的ID与本地ID不同，更新会话ID
      if (savedId && savedId !== localId) {
        console.log('🔵 startNewSession 更新本地ID为服务器ID:', savedId);
        setSessions(prev => prev.map(s => 
          s.id === localId ? { ...s, id: savedId } : s
        ));
        setCurrentSessionId(savedId);
        
        // 更新本地存储
        const updatedSessions = sessions.map(s => 
          s.id === localId ? { ...s, id: savedId } : s
        );
        localStorage.setItem(`chat_sessions_${user.id}`, JSON.stringify(updatedSessions));
      }
    } catch (error) {
      console.error('❌ 创建新会话失败:', error);
    }
  };

  const saveSessionToDB = async (userId: string, session: ChatSession): Promise<string> => {
    try {
      const isLocalId = session.id.startsWith('local_');
      console.log('🟢 saveSessionToDB 开始保存会话:', session.id, '是本地ID:', isLocalId);
      
      const res = await authFetch('/api/chat/save', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: isLocalId ? undefined : session.id, // 如果是本地ID，则不传给服务器
          title: session.title,
          messages: session.messages,
        }),
      });

      const data = await res.json();
      console.log('🟢 saveSessionToDB 服务器返回:', data);

      if (data.success && data.sessionId) {
        // 如果是本地ID，需要更新会话ID为服务器返回的ID
        if (isLocalId && data.sessionId !== session.id) {
          console.log('🟢 saveSessionToDB 本地ID需要更新为服务器ID:', data.sessionId);
          
          // 更新本地状态
          setSessions(prevSessions => {
            const updated = prevSessions.map(s => 
              s.id === session.id ? { ...s, id: data.sessionId } : s
            );
            
            // 更新本地存储
            localStorage.setItem(`chat_sessions_${userId}`, JSON.stringify(updated));
            
            return updated;
          });
          
          // 如果当前会话ID是被更新的会话ID，也需要更新currentSessionId
          if (currentSessionId === session.id) {
            console.log('🟢 saveSessionToDB 更新当前会话ID:', data.sessionId);
            setCurrentSessionId(data.sessionId);
          }
          
          return data.sessionId;
        }
      }
      
      return session.id; // 如果没有更新ID，则返回原ID
    } catch (error) {
      console.error('❌ 保存会话失败:', error);
      return session.id; // 出错时返回原ID
    }
  };

  // 删除聊天记录
  const deleteSession = async (sessionId: string) => {
    try {
      // 如果是本地会话，直接删除
      if (sessionId.startsWith('local_')) {
        removeSessionLocally(sessionId);
        return;
      }

      // 发送删除请求到服务器
      const res = await authFetch(`/api/chat/delete/${sessionId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        console.log('✅ 聊天记录已从服务器删除');
        removeSessionLocally(sessionId);
      } else {
        const error = await res.json();
        console.error('❌ 删除聊天记录失败:', error);
        setError('删除失败，请稍后重试');
      }
    } catch (err) {
      console.error('❌ 删除聊天记录失败:', err);
      setError('删除失败，请稍后重试');
    }
  };

  // 从本地移除会话
  const removeSessionLocally = (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    if (user?.id) {
      localStorage.setItem(`chat_sessions_${user.id}`, JSON.stringify(updated));
    }

    // 如果删除的是当前会话，切换到第一个会话
    if (sessionId === currentSessionId) {
      setCurrentSessionId(updated[0]?.id || '');
    }
  };

  // 处理删除按钮点击
  const handleDeleteClick = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发会话选择
    setSessionToDelete(sessionId);
    setShowDeleteConfirm(true);
  };

  // 确认删除
  const confirmDelete = () => {
    if (sessionToDelete) {
      deleteSession(sessionToDelete);
      setShowDeleteConfirm(false);
      setSessionToDelete('');
    }
  };

  // 取消删除
  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setSessionToDelete('');
  };

  // 异步搜索相关笔记
  const searchRelatedNotesAsync = async (userMessage: string, aiReply: string, sessionId: string, messageIndex: number) => {
    try {
      console.log('🔍 开始异步搜索相关笔记...');
      
      // 先更新消息状态，显示搜索中的提示
      setSessions(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            const updatedMessages = [...session.messages];
            if (updatedMessages[messageIndex]) {
              updatedMessages[messageIndex] = {
                ...updatedMessages[messageIndex],
                searchingNotes: true
              };
            }
            return { ...session, messages: updatedMessages };
          }
          return session;
        });
      });

      const res = await authFetch('/api/chat/search-related-notes', {
        method: 'POST',
        body: JSON.stringify({ userMessage, aiReply }),
      });

      if (res.ok) {
        const data = await res.json();
        const relatedNotes = data.relatedNotes || [];
        
        console.log('📝 找到相关笔记:', relatedNotes.length, '条');

        // 更新消息，添加相关笔记
        setSessions(prevSessions => {
          return prevSessions.map(session => {
            if (session.id === sessionId) {
              const updatedMessages = [...session.messages];
              if (updatedMessages[messageIndex]) {
                updatedMessages[messageIndex] = {
                  ...updatedMessages[messageIndex],
                  relatedNotes: relatedNotes,
                  searchingNotes: false
                };
              }
              return { ...session, messages: updatedMessages };
            }
            return session;
          });
        });

        // 更新本地存储
        if (user?.id) {
          const updatedSessions = sessions.map(session => {
            if (session.id === sessionId) {
              const updatedMessages = [...session.messages];
              if (updatedMessages[messageIndex]) {
                updatedMessages[messageIndex] = {
                  ...updatedMessages[messageIndex],
                  relatedNotes: relatedNotes,
                  searchingNotes: false
                };
              }
              return { ...session, messages: updatedMessages };
            }
            return session;
          });
          localStorage.setItem(`chat_sessions_${user.id}`, JSON.stringify(updatedSessions));
        }
      } else {
        console.error('搜索相关笔记失败');
        // 移除搜索中状态
        setSessions(prevSessions => {
          return prevSessions.map(session => {
            if (session.id === sessionId) {
              const updatedMessages = [...session.messages];
              if (updatedMessages[messageIndex]) {
                updatedMessages[messageIndex] = {
                  ...updatedMessages[messageIndex],
                  searchingNotes: false
                };
              }
              return { ...session, messages: updatedMessages };
            }
            return session;
          });
        });
      }
    } catch (error) {
      console.error('搜索相关笔记出错:', error);
      // 移除搜索中状态
      setSessions(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            const updatedMessages = [...session.messages];
            if (updatedMessages[messageIndex]) {
              updatedMessages[messageIndex] = {
                ...updatedMessages[messageIndex],
                searchingNotes: false
              };
            }
            return { ...session, messages: updatedMessages };
          }
          return session;
        });
      });
    }
  };

  const handleSend = async () => {
    console.log('🚦 handleSend 触发, input:', input, 'currentSession:', currentSession, 'loading:', loading);
    if (!input.trim()) {
      console.log('⚠️ 输入为空, 不发送');
      return;
    }
    if (!currentSession) {
      setError('当前会话不存在，无法发送消息');
      console.log('❌ currentSession 不存在, 无法发送');
      return;
    }
    if (!user?.id) {
      setError('用户未初始化，无法发送消息');
      console.log('❌ user 不存在, 无法发送');
      return;
    }

    // 确保消息的role严格为'user'或'assistant'
    const userMessage: Message = { role: 'user', content: input };
    const updatedMessages: Message[] = [...currentSession.messages, userMessage];

    // 先更新本地状态
    updateSessionMessages(currentSession.id, updatedMessages);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await authFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: updatedMessages, sessionId: currentSession.id }),
      });
      
      if (!res.ok) {
        // 尝试解析错误信息
        try {
          const errorData = await res.json();
          throw new Error(errorData.error || '请求失败');
        } catch {
          throw new Error('请求失败');
        }
      }
      
      const data = await res.json();

      // 确保返回消息的role为'assistant'
      const assistantMessage: Message = { 
        role: 'assistant', 
        content: data.reply
      };
      const finalMessages: Message[] = [...updatedMessages, assistantMessage];

      // 更新本地状态
      updateSessionMessages(currentSession.id, finalMessages);

      // 异步搜索相关笔记
      searchRelatedNotesAsync(userMessage.content, assistantMessage.content, currentSession.id, finalMessages.length - 1);

      // 自动摘要并更新会话标题
      try {
        const summaryRes = await authFetch('/api/chat/summarizeTitle', {
          method: 'POST',
          body: JSON.stringify({
            userContent: userMessage.content,
            aiContent: assistantMessage.content
          })
        });
        if (summaryRes.ok) {
          const { title } = await summaryRes.json();
          // 更新会话标题
          setSessions(prevSessions => {
            const updated = prevSessions.map(s =>
              s.id === currentSession.id ? { ...s, title } : s
            );
            // 更新本地存储
            if (user?.id) {
              localStorage.setItem(`chat_sessions_${user.id}`, JSON.stringify(updated));
            }
            return updated;
          });
          
          // 保存到数据库
          const newSessionId = await saveSessionToDB(user.id, { ...currentSession, messages: finalMessages, title });
          console.log('🚦 handleSend 保存会话后返回的ID:', newSessionId);
        } else {
          // 摘要失败也要保存消息
          const newSessionId = await saveSessionToDB(user.id, { ...currentSession, messages: finalMessages });
          console.log('🚦 handleSend 保存会话后返回的ID:', newSessionId);
        }
      } catch (e) {
        const newSessionId = await saveSessionToDB(user.id, { ...currentSession, messages: finalMessages });
        console.log('🚦 handleSend 保存会话后返回的ID:', newSessionId);
      }
    } catch (err: any) {
      console.error('发送消息失败:', err);
      // 显示具体的错误信息
      setError(err.message || '发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };
  
  const updateSessionMessages = (sessionId: string, newMessages: Message[]) => {
    console.log('📝 updateSessionMessages 更新会话消息, sessionId:', sessionId, '新消息数量:', newMessages.length);
    
    // 创建一个新的会话数组，而不是直接修改原数组
    setSessions(prevSessions => {
      // 找到当前会话
      const sessionToUpdate = prevSessions.find(s => s.id === sessionId);
      if (!sessionToUpdate) {
        console.log('📝 updateSessionMessages 未找到会话:', sessionId);
        return prevSessions; // 如果找不到会话，返回原状态
      }
      
      // 更新会话消息
      const updated = prevSessions.map((s) =>
        s.id === sessionId ? { ...s, messages: newMessages } : s
      );
      console.log('📝 updateSessionMessages 更新后的sessions数量:', updated.length);
      
      // 更新本地存储
      if (user?.id) {
        localStorage.setItem(`chat_sessions_${user.id}`, JSON.stringify(updated));
      }
      
      return updated;
    });
  };

  // 如果是服务端渲染，返回加载占位符
  if (!isClient) {
    return <div>Loading...</div>;
  }

  if (!user) return <div>🚀 正在验证用户身份...</div>;

  return (
    <div className={styles.container}>
      <TopNavigation />
      {/* 左侧历史面板 */}
      <aside className={styles.historyPanel}>
        <div className={styles.historyHeader}>
          <span>💭 聊天记录</span>
          <button onClick={startNewSession} title="新建对话">
            ✨
          </button>
        </div>
        <ul className={styles.historyList}>
          {isClient && sessions.length === 0 ? (
            <div className={styles.emptyState} style={{ height: 'auto', padding: '20px 0' }}>
              <div className={styles.emptyText} style={{ fontSize: '14px', marginBottom: '8px' }}>
                暂无聊天记录
              </div>
              <div className={styles.emptySubtext} style={{ fontSize: '12px' }}>
                开始新对话后会显示在这里
              </div>
            </div>
          ) : (
            isClient && sessions.map((s) => {
              return (
                <li
                  key={s.id}
                  className={s.id === currentSessionId ? styles.activeHistory : ''}
                  onClick={() => setCurrentSessionId(s.id)}
                >
                  <span>{s.title}</span>
                  <button 
                    className={styles.deleteButton}
                    onClick={(e) => handleDeleteClick(e, s.id)}
                    title="删除对话"
                  >
                    🗑️
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      {/* 右侧主要内容区域 */}
      <main className={styles.mainContent}>
        <div className={styles.contentWrapper}>
          <div className={styles.cardList}>
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>💬</div>
                <div className={styles.emptyText}>开始新的对话</div>
                <div className={styles.emptySubtext}>
                  向AI助手提问任何问题，我会尽力为您提供帮助
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <ChatMessage 
                  key={index} 
                  role={msg.role} 
                  content={msg.content} 
                  relatedNotes={msg.relatedNotes}
                  searchingNotes={msg.searchingNotes}
                />
              ))
            )}
          </div>
        </div>
      </main>

      {/* 固定在底部的输入框 */}
      <div className={styles.inputContainer}>
        <div className={styles.inputWrapper}>
          <textarea
            className={styles.inputField}
            placeholder={loading ? "AI正在思考中..." : "输入您的问题..."}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              console.log('📝 输入框内容变化:', e.target.value);
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            disabled={loading}
          />
          <button
            onClick={() => {
              console.log('📨 点击了 Send 按钮, 当前input:', input, 'loading:', loading, 'currentSession:', currentSession);
              handleSend();
            }}
            disabled={loading || !input.trim()}
            className={styles.submitButton}
          >
            {loading ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="31.416">
                  <animate attributeName="stroke-dasharray" dur="2s" values="0 31.416;15.708 15.708;0 31.416;0 31.416" repeatCount="indefinite"/>
                  <animate attributeName="stroke-dashoffset" dur="2s" values="0;-15.708;-31.416;-31.416" repeatCount="indefinite"/>
                </circle>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
        <div className={styles.disclaimer}>
          AI也可能会犯错。请核查重要信息
        </div>
      </div>
      {error && <p className={styles.errorText}>{error}</p>}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className={styles.confirmModal}>
          <div className={styles.confirmDialog}>
            <h3>确认删除会话</h3>
            <p>您确定要删除此会话吗？此操作不可撤销。</p>
            <div className={styles.confirmButtons}>
              <button onClick={cancelDelete}>取消</button>
              <button onClick={confirmDelete}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
