'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser, isAuthenticated } from '../../utils/auth';
import { getFeed, triggerAnalysis, FeedResponse, FeedItem } from '../../services/feedService';
import TopNavigation from '../../components/TopNavigation';
import styles from './profile.module.scss';
import { toast } from 'sonner';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    // Auth Check
    if (!isAuthenticated()) {
      router.push('/auth');
      return;
    }
    setUser(getUser());

    // Fetch Data
    loadFeed();
  }, [router]);

  const loadFeed = async () => {
    try {
      setLoading(true);
      const res = await getFeed();
      setData(res);
    } catch (error) {
      console.error('Failed to load feed:', error);
      toast.error('无法加载个人中心数据');
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerAnalysis = async () => {
    try {
      setAnalyzing(true);
      toast.info('正在开始画像分析，请稍候...');
      await triggerAnalysis();
      toast.success('分析任务已触发，请稍后刷新页面查看结果');
      // Optimistically update status
      if (data) {
        setData({ ...data, profileStatus: 'analyzing' });
      }
    } catch (error) {
      console.error('Failed to trigger analysis:', error);
      toast.error('触发分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFeedClick = (noteId: string) => {
    router.push(`/notes?highlight=${noteId}`);
  };

  if (!user) {
    return (
      <div className="!min-h-screen !bg-gray-50">
        <TopNavigation />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 60px)', color: '#888' }}>
          <div className="flex flex-col items-center gap-3">
            <div className="loading-spinner" style={{
              width: '24px',
              height: '24px',
              border: '3px solid rgba(0,0,0,0.1)',
              borderTopColor: '#333',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span>Loading...</span>
          </div>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="!min-h-screen !bg-gray-50">
      <TopNavigation />
      <div className={`${styles.container} !max-w-5xl !mx-auto !px-6 !py-8 !mt-16`}>
        {/* Left Column: User Profile */}
        <div className={styles.leftColumn}>
          {/* User Info Card */}
          <div className={`${styles.card} !bg-white !shadow-sm !border !border-gray-100 !rounded-2xl !p-6`}>
            <div className={`${styles.profileHeader} !mb-6`}>
              <div className={`${styles.avatar} !w-16 !h-16 !rounded-full !bg-gradient-to-br !from-blue-500 !to-indigo-500 !flex !items-center !justify-center !text-2xl !font-bold !text-white !shadow-md`}>
                {user.username?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className={styles.userInfo}>
                <h2 className="!text-xl !font-semibold !text-gray-900 !mb-1">{user.username}</h2>
                <p className="!text-sm !text-gray-500">{user.email}</p>
              </div>
            </div>
            
            <div className={`${styles.sectionTitle} !flex !items-center !justify-between !mb-4`}>
              <span className="!text-sm !font-medium !text-gray-700">用户画像状态</span>
              <button 
                className="!text-xs !px-3 !py-1.5 !rounded-lg !bg-gray-50 hover:!bg-gray-100 !border !border-gray-200 !text-gray-600 !transition-colors disabled:!opacity-50 disabled:!cursor-not-allowed"
                onClick={handleTriggerAnalysis} 
                disabled={analyzing || data?.profileStatus === 'analyzing'}
              >
                {data?.profileStatus === 'analyzing' ? '分析中...' : '更新画像'}
              </button>
            </div>
          </div>

          {/* Biography */}
          {data?.userProfile?.summary && (
            <div className={`${styles.card} !bg-white !shadow-sm !border !border-gray-100 !rounded-2xl !p-6`}>
              <div className={`${styles.sectionTitle} !text-base !font-semibold !text-gray-900 !mb-3`}>个人传记</div>
              <div className={`${styles.biography} !text-sm !leading-relaxed !text-gray-600 !whitespace-pre-wrap`}>
                {data.userProfile.summary}
              </div>
            </div>
          )}

          {/* Interests */}
          {data?.userProfile?.interests && data.userProfile.interests.length > 0 && (
            <div className={`${styles.card} !bg-white !shadow-sm !border !border-gray-100 !rounded-2xl !p-6`}>
              <div className={`${styles.sectionTitle} !text-base !font-semibold !text-gray-900 !mb-4`}>兴趣图谱</div>
              <div className={`${styles.tags} !flex !flex-wrap !gap-2`}>
                {data.userProfile.interests.map((interest, idx) => (
                  <div key={idx} className={`${styles.tag} !flex !items-center !gap-1.5 !px-3 !py-1 !rounded-full !bg-blue-50 !text-blue-600 !text-xs`}>
                    <span>{interest.topic}</span>
                    <span className={`${styles.score} !opacity-70 !text-[10px]`}>{Math.round(interest.score * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expertise */}
          {data?.userProfile?.expertise && data.userProfile.expertise.length > 0 && (
            <div className={`${styles.card} !bg-white !shadow-sm !border !border-gray-100 !rounded-2xl !p-6`}>
              <div className={`${styles.sectionTitle} !text-base !font-semibold !text-gray-900 !mb-4`}>技能领域</div>
              <div className={`${styles.expertiseList} !flex !flex-col !gap-3`}>
                {data.userProfile.expertise.map((exp, idx) => (
                  <div key={idx} className={`${styles.expertiseItem} !flex !justify-between !items-center !p-3 !bg-gray-50 !rounded-xl`}>
                    <span className={`${styles.area} !text-sm !font-medium !text-gray-700`}>{exp.area}</span>
                    <span className={`${styles.level} !text-xs !px-2.5 !py-1 !rounded-md !bg-emerald-50 !text-emerald-600`}>{exp.level}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Personalized Feed */}
        <div className={styles.rightColumn}>
          <h1 className="!text-2xl !font-bold !text-gray-900 !mb-6">
            每日推荐 (For You)
          </h1>

          {loading ? (
            <div className={`${styles.card} !bg-white !shadow-sm !border !border-gray-100 !rounded-2xl !p-12 !text-center !text-gray-500`}>
              加载中...
            </div>
          ) : data?.feed && data.feed.length > 0 ? (
            <div className={`${styles.feedList} !flex !flex-col !gap-4`}>
              {data.feed.map((item, idx) => (
                <div 
                  key={idx} 
                  className={`${styles.feedItem} ${item.type === 'rediscover' ? styles.rediscover : ''} !bg-white hover:!bg-gray-50 !border !border-gray-100 !shadow-sm !rounded-xl !p-5 !cursor-pointer !transition-all !relative !overflow-hidden`}
                  onClick={() => handleFeedClick(item.noteId)}
                >
                  {/* Left accent border */}
                  <div className={`!absolute !left-0 !top-0 !bottom-0 !w-1 ${item.type === 'rediscover' ? '!bg-pink-400' : '!bg-blue-400'} !opacity-60`} />
                  
                  <div className={`${styles.feedHeader} !flex !justify-between !items-center !mb-3`}>
                    <span className={`${styles.feedType} !text-xs !font-semibold !px-2 !py-1 !rounded-md ${item.type === 'rediscover' ? '!bg-pink-50 !text-pink-600' : '!bg-blue-50 !text-blue-600'} !uppercase !tracking-wider`}>
                      {item.type === 'rediscover' ? '温故知新' : '最新动态'}
                    </span>
                    <span className={`${styles.feedReason} !text-xs !italic !text-gray-400`}>{item.reason}</span>
                  </div>
                  <div className={`${styles.feedTitle} !text-base !font-semibold !text-gray-900 !mb-2`}>{item.title || '未命名笔记'}</div>
                  <div className={`${styles.feedPreview} !text-sm !text-gray-500 !leading-relaxed !line-clamp-3`}>{item.content}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={`${styles.card} ${styles.emptyState} !bg-white !shadow-sm !border !border-gray-100 !rounded-2xl !p-12 !text-center !flex !flex-col !items-center !gap-4`}>
              <div className="!text-gray-500 !text-sm !space-y-1">
                <p>暂无推荐内容。</p>
                <p>多写几条笔记，或者点击左侧“更新画像”来生成推荐。</p>
              </div>
              <button 
                className="!mt-2 !px-5 !py-2 !bg-blue-600 hover:!bg-blue-700 !text-white !rounded-lg !text-sm !font-medium !transition-colors !border-none"
                onClick={() => router.push('/notes')}
              >
                去写笔记
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
