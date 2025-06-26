'use client';

import { useEffect, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import NoteCard from '../../components/NoteCard';
import styles from './notes.module.scss';

interface Note {
  _id: string;
  title: string;
  content: string;
  keywords: string[];
  createdAt: string;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [newContent, setNewContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/notes')
      .then((res) => {
        
        if (!res.ok) throw new Error(`请求失败: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log('📝 /api/notes 返回内容:', data);

        // 正确地提取 notes 字段
        if (Array.isArray(data.notes)) {
          setNotes(data.notes);
          
        } else {
          console.warn('⚠️ /api/notes 返回格式错误:', data);
          setNotes([]);
        }
      })
      .catch((err) => {
        console.error('加载失败:', err);
        setError('加载失败，请稍后重试');
      });
  }, []);

  const handleSubmit = async () => {
    if (!newContent.trim()) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });

      if (!res.ok) throw new Error(`提交失败: ${res.status}`);
      const newNote = await res.json();

      setNotes((prev) => [newNote, ...prev]);
      setNewContent('');
    } catch (err) {
      console.error(err);
      setError('提交失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('删除失败');
      setNotes((prev) => prev.filter((note) => note._id !== id));
    } catch (err) {
      console.error('删除失败:', err);
      setError('删除失败，请稍后重试');
    }
  };

  return (
    <div className={styles.container}>
      <Sidebar />
      <main className={styles.mainContent}>
        <h1 className={styles.pageTitle}>📝 我的笔记</h1>

        <div className={styles.cardList}>
          {notes.length === 0 ? (
            <p className={styles.emptyText}>暂无笔记</p>
          ) : (
            notes.map((note) => (
              <NoteCard
                key={note._id}
                title={note.title}
                content={note.content}
                keywords={note.keywords}
                createdAt={note.createdAt}
                onDelete={() => handleDelete(note._id)}
              />
            ))
          )}
        </div>

        <div className={styles.inputWrapper}>
          <textarea
              className={styles.inputField}
              placeholder="有什么事情要记录吗？"
              value={newContent}
              rows={3}
              onChange={(e) => {
                setNewContent(e.target.value);
                const el = e.target;
                el.style.height = 'auto'; // 先重置
                el.style.height = `${Math.min(el.scrollHeight, 200)}px`; // 限高为 200px
              }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={styles.submitButton}
          >
            ✈️
          </button>
        </div>

        {error && <p className={styles.errorText}>{error}</p>}
      </main>
    </div>
  );
}
