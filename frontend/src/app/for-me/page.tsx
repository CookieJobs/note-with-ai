'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
// import Sidebar from '../../components/Sidebar';
// import MobileMenuButton from '../../components/MobileMenuButton';
import { authFetch } from '../../utils/auth';
import styles from './for-me.module.scss';
import TopNavigation from '../../components/TopNavigation';

// 数据类型定义
interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt: string;
  relevanceScore: number;
  category: string;
  readingTime: number;
  isFavorited?: boolean;
  userRating?: number;
  recommendationReason?: string;
}

interface ForMeNoteData {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
  articles: SearchResult[];
}

interface UserPreferences {
  favoriteCategories: string[];
  readingHistory: string[];
  articleRatings: { [articleId: string]: number };
  favoriteArticles: string[];
}

export default function ForMePage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [data, setData] = useState<ForMeNoteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingNotes, setRefreshingNotes] = useState<Set<string>>(new Set());
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({
    favoriteArticles: [],
    readingHistory: [],
    articleRatings: {},
    favoriteCategories: []
  });
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'rating'>('relevance');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  // 顶部导航布局下不再需要移动端菜单开关

  // AI 机器人状态
  const [robotLoading, setRobotLoading] = useState<boolean>(false);
  const [robotError, setRobotError] = useState<string | null>(null);
  const [robotIntro, setRobotIntro] = useState<{ noteId: string | null; noteTitle: string; snippet: string; aiOpening: string } | null>(null);

  // 检查用户身份验证
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/auth');
      return;
    }
    setIsAuthenticated(true);
    setAuthLoading(false);
  }, [router]);

  // 获取 For Me 数据
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await authFetch('/api/for-me');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 获取AI机器人开场白
  const fetchRobotIntro = async () => {
    setRobotLoading(true);
    setRobotError(null);
    try {
      const res = await authFetch('/api/for-me/robot/intro');
      const json = await res.json();
      // 兼容 ResponseHandler.success 包装或直接数据
      const payload = json && json.data ? json.data : json;
      setRobotIntro({
        noteId: payload.noteId ?? null,
        noteTitle: payload.noteTitle || '',
        snippet: payload.snippet || '',
        aiOpening: payload.aiOpening || '最近还好吗？我想来问候一下。'
      });
    } catch (e) {
      setRobotError('获取AI开场失败，请稍后重试');
    } finally {
      setRobotLoading(false);
    }
  };

  // 继续在聊天页交流：创建会话并跳转
  const continueInChat = async () => {
    if (!robotIntro) return router.push('/chat');
    try {
      await authFetch('/api/chat/save', {
        method: 'POST',
        body: JSON.stringify({
          // 不传 sessionId 表示创建新会话
          title: robotIntro.noteTitle ? `关怀 · ${robotIntro.noteTitle}` : '关怀对话',
          messages: [
            { role: 'assistant', content: robotIntro.aiOpening },
          ],
        })
      });
    } catch (e) {
      // 忽略错误，直接跳转
    } finally {
      router.push('/chat');
    }
  };

  // 刷新特定笔记的文章推荐
  const refreshNoteArticles = async (noteId: string) => {
    setRefreshingNotes(prev => new Set(prev).add(noteId));
    
    try {
      const response = await authFetch(`/api/for-me/refresh/${noteId}`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const updatedNote = await response.json();
      
      // 更新本地数据
      setData(prevData => {
        if (!prevData) return prevData;
        return prevData.map(note => 
          note.id === noteId 
            ? { ...note, articles: updatedNote.articles }
            : note
        );
      });
    } catch (err) {
      console.error('刷新文章失败:', err);
      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      setRefreshingNotes(prev => {
        const newSet = new Set(prev);
        newSet.delete(noteId);
        return newSet;
      });
    }
  };

  // 加载用户偏好
  const loadUserPreferences = () => {
    const saved = localStorage.getItem('forMePreferences');
    if (saved) {
      setUserPreferences(JSON.parse(saved));
    }
  };

  // 保存用户偏好
  const saveUserPreferences = (preferences: UserPreferences) => {
    localStorage.setItem('forMePreferences', JSON.stringify(preferences));
    setUserPreferences(preferences);
  };

  // 收藏/取消收藏文章
  const toggleFavorite = (articleId: string) => {
    const newPreferences = { ...userPreferences };
    if (newPreferences.favoriteArticles.includes(articleId)) {
      newPreferences.favoriteArticles = newPreferences.favoriteArticles.filter(id => id !== articleId);
    } else {
      newPreferences.favoriteArticles.push(articleId);
    }
    saveUserPreferences(newPreferences);
  };

  // 评分文章
  const rateArticle = (articleId: string, rating: number) => {
    const newPreferences = { ...userPreferences };
    newPreferences.articleRatings[articleId] = rating;
    saveUserPreferences(newPreferences);
  };

  // 记录阅读历史
  const markAsRead = (articleId: string, category: string) => {
    const newPreferences = { ...userPreferences };
    if (!newPreferences.readingHistory.includes(articleId)) {
      newPreferences.readingHistory.push(articleId);
    }
    if (!newPreferences.favoriteCategories.includes(category)) {
      newPreferences.favoriteCategories.push(category);
    }
    saveUserPreferences(newPreferences);
  };

  // 获取所有文章分类
  const getAllCategories = () => {
    if (!data) return [];
    const categories = new Set<string>();
    data.forEach(note => {
      note.articles.forEach(article => {
        categories.add(article.category);
      });
    });
    return Array.from(categories);
  };

  // 筛选和排序文章
  const getFilteredAndSortedArticles = (articles: SearchResult[]) => {
    let filtered = articles;

    // 按分类筛选
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(article => article.category === selectedCategory);
    }

    // 只显示收藏的文章
    if (showFavoritesOnly) {
      filtered = filtered.filter(article => userPreferences.favoriteArticles.includes(article.id));
    }

    // 排序
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return b.relevanceScore - a.relevanceScore;
        case 'date':
          return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        case 'rating':
          const ratingA = userPreferences.articleRatings[a.id] || 0;
          const ratingB = userPreferences.articleRatings[b.id] || 0;
          return ratingB - ratingA;
        default:
          return 0;
      }
    });

    return filtered;
  };

  // 组件挂载时获取数据
  useEffect(() => {
    if (isAuthenticated) {
      loadUserPreferences();
      fetchData();
      fetchRobotIntro();
    }
  }, [isAuthenticated]);

  // 身份验证加载中
  if (authLoading) {
    return (
      <div className={styles.container}>
        {/* <Sidebar /> */}
        <main className={styles.mainContent}>
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>正在验证身份...</p>
          </div>
        </main>
      </div>
    );
  }

  // 未认证用户
  if (!isAuthenticated) {
    return null; // 会被重定向到登录页面
  }

  return (
    <div className={styles.container}>
      <TopNavigation />
      <main className={styles.mainContent}>
        <div className={styles.header}>
          <h1 className={styles.title}>For Me</h1>
          <p className={styles.subtitle}>基于你的笔记内容，为你推荐相关文章</p>
        </div>

        {/* AI 关怀助手 */}
        <div className={styles.aiRobotCard}>
          <div className={styles.aiRobotHeader}>
            <div className={styles.aiRobotTitle}>🤖 AI 关怀助手</div>
            <div className={styles.aiRobotDesc}>我会随机查看你的一条历史笔记片段，轻声问候，给你一点贴心的提醒与陪伴。</div>
          </div>

          {robotLoading && (
            <div className={styles.robotLoading}>正在读取你的记录与心情...</div>
          )}

          {robotError && (
            <div className={styles.robotError}>❌ {robotError}</div>
          )}

          {!robotLoading && !robotError && robotIntro && (
            <div className={styles.aiRobotContent}>
              {robotIntro.noteTitle && (
                <div className={styles.robotNoteTitle}>来源笔记：{robotIntro.noteTitle}</div>
              )}
              {robotIntro.snippet && (
                <div className={styles.robotSnippet}>“{robotIntro.snippet}”</div>
              )}
              <div className={styles.robotOpening}>{robotIntro.aiOpening}</div>

              <div className={styles.aiRobotActions}>
                <button className={styles.robotButtonSecondary} onClick={fetchRobotIntro}>换一个</button>
                <button className={styles.robotButtonPrimary} onClick={continueInChat}>继续在聊天中聊</button>
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner}></div>
            <p>正在为你寻找相关文章...</p>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <p>❌ {error}</p>
            <button onClick={fetchData} className={styles.retryButton}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && (!data || data.length === 0) && (
          <div className={styles.empty}>
            <p>📝 还没有笔记，快去添加一些笔记吧！</p>
            <Link href="/notes" className={styles.addNoteLink}>
              去添加笔记
            </Link>
          </div>
        )}

        {!loading && !error && data && data.length > 0 && (
          <>
            {/* 筛选和排序控件 */}
            <div className={styles.filterControls}>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>分类筛选:</label>
                <select 
                  value={selectedCategory} 
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className={styles.filterSelect}
                >
                  <option value="all">全部分类</option>
                  {getAllCategories().map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>排序方式:</label>
                <select 
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value as 'relevance' | 'date' | 'rating')}
                  className={styles.filterSelect}
                >
                  <option value="relevance">相关度</option>
                  <option value="date">发布时间</option>
                  <option value="rating">我的评分</option>
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label className={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={showFavoritesOnly}
                    onChange={(e) => setShowFavoritesOnly(e.target.checked)}
                    className={styles.toggleInput}
                  />
                  <span className={styles.toggleSlider}></span>
                  只显示收藏
                </label>
              </div>
            </div>

            <div className={styles.notesScrollContainer}>
              <div className={styles.notesList}>
                {data.map((note) => (
                  <div key={note.id} className={styles.noteCard}>
                  <div className={styles.noteHeader}>
                    <h3 className={styles.noteTitle}>{note.title}</h3>
                    <button
                      onClick={() => refreshNoteArticles(note.id)}
                      disabled={refreshingNotes.has(note.id)}
                      className={styles.refreshButton}
                      title="刷新推荐"
                    >
                      {refreshingNotes.has(note.id) ? '🔄' : '🔄'}
                    </button>
                  </div>
                  
                  <p className={styles.noteContent}>{note.content}</p>
                  
                  {note.keywords && note.keywords.length > 0 && (
                    <div className={styles.keywords}>
                      {note.keywords.map((keyword, index) => (
                        <span key={index} className={styles.keyword}>
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className={styles.articlesSection}>
                    <h4 className={styles.articlesTitle}>
                      相关文章推荐 
                      {note.articles && note.articles.length > 0 && (
                        <span className={styles.articleCount}>({getFilteredAndSortedArticles(note.articles).length})</span>
                      )}
                    </h4>
                    
                    {refreshingNotes.has(note.id) && (
                      <div className={styles.articleLoading}>
                        <div className={styles.spinner}></div>
                        <span>正在刷新推荐...</span>
                      </div>
                    )}
                    
                    {!refreshingNotes.has(note.id) && note.articles && note.articles.length > 0 && (
                      <div className={styles.articlesList}>
                        {getFilteredAndSortedArticles(note.articles).map((article) => (
                          <div key={article.id} className={styles.articleCard}>
                            <div className={styles.articleHeader}>
                              <div className={styles.articleMeta}>
                                <span className={styles.articleCategory}>{article.category}</span>
                                <span className={styles.articleSource}>{article.source}</span>
                                <span className={styles.readingTime}>📖 {article.readingTime}分钟</span>
                              </div>
                              <div className={styles.articleActions}>
                                <button
                                  onClick={() => toggleFavorite(article.id)}
                                  className={`${styles.favoriteButton} ${userPreferences.favoriteArticles.includes(article.id) ? styles.favorited : ''}`}
                                  title={userPreferences.favoriteArticles.includes(article.id) ? '取消收藏' : '收藏文章'}
                                >
                                  {userPreferences.favoriteArticles.includes(article.id) ? '❤️' : '🤍'}
                                </button>
                              </div>
                            </div>

                            <h5 className={styles.articleTitle}>
                              <a 
                                href={article.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                onClick={() => markAsRead(article.id, article.category)}
                              >
                                {article.title}
                              </a>
                            </h5>
                            
                            <p className={styles.articleSnippet}>{article.snippet}</p>
                            
                            {article.recommendationReason && (
                              <div className={styles.recommendationReason}>
                                <span className={styles.reasonLabel}>💡 推荐理由:</span>
                                <span className={styles.reasonText}>{article.recommendationReason}</span>
                              </div>
                            )}

                            <div className={styles.articleFooter}>
                              <div className={styles.relevanceScore}>
                                相关度: {Math.round(article.relevanceScore * 100)}%
                              </div>
                              
                              <div className={styles.ratingSection}>
                                <span className={styles.ratingLabel}>评分:</span>
                                <div className={styles.starRating}>
                                  {[1, 2, 3, 4, 5].map(star => (
                                    <button
                                      key={star}
                                      onClick={() => rateArticle(article.id, star)}
                                      className={`${styles.starButton} ${(userPreferences.articleRatings[article.id] || 0) >= star ? styles.starFilled : ''}`}
                                    >
                                      ⭐
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {!refreshingNotes.has(note.id) && (!note.articles || getFilteredAndSortedArticles(note.articles).length === 0) && (
                      <div className={styles.noArticles}>
                        <p>{showFavoritesOnly ? '暂无收藏的文章' : '暂无相关文章'}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.footer}>
          <div className={styles.statsSection}>
            <h3 className={styles.statsTitle}>📊 个性化统计</h3>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{userPreferences.favoriteArticles.length}</div>
                <div className={styles.statLabel}>收藏文章</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{userPreferences.readingHistory.length}</div>
                <div className={styles.statLabel}>已读文章</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{Object.keys(userPreferences.articleRatings).length}</div>
                <div className={styles.statLabel}>已评分</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statNumber}>{userPreferences.favoriteCategories.length}</div>
                <div className={styles.statLabel}>关注分类</div>
              </div>
            </div>
          </div>
          
          <div className={styles.tipsSection}>
            <h4 className={styles.tipsTitle}>💡 使用提示</h4>
            <ul className={styles.tipsList}>
              <li>点击 ❤️ 收藏感兴趣的文章</li>
              <li>为文章评分帮助改进推荐算法</li>
              <li>使用筛选功能快速找到想要的内容</li>
              <li>点击刷新按钮获取最新推荐</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}