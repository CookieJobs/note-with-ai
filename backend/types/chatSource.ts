/** The server-owned saved note content actually supplied to one chat turn. */
export interface ChatSourceSnapshot {
  noteId: string;
  title?: string;
  contentText: string;
  revision: number;
  updatedAt: string;
  hasImages: boolean;
}
