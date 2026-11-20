import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NoteDiscoveryPanel from './NoteDiscoveryPanel';
import { noteDiscoveries, type DiscoveryList, type NoteDiscovery } from '../services/noteDiscoveries';
vi.mock('../services/noteDiscoveries', async importOriginal => ({ ...await importOriginal<typeof import('../services/noteDiscoveries')>(), noteDiscoveries: { list: vi.fn(), preferences: vi.fn(), session: vi.fn(), feedback: vi.fn(), undo: vi.fn(), save: vi.fn(), run: vi.fn() } }));
export const card: NoteDiscovery = { id: 'a', kind: 'connection', title: '一个联系', observation: '观察到的具体线索', whyNow: '最近有新进展', qualification: '还需要确认', suggestedAction: '从一个小步骤开始', draft: '原来的草稿', evidence: [{ noteId: 'n1', title: '来源一', revision: 3, excerpt: '原文依据', hasImages: false, noteDate: '2026-11-17T00:00:00Z' }], status: 'ready', createdAt: '2026-11-17T00:00:00Z' };
const list = (overrides: Partial<DiscoveryList> = {}): DiscoveryList => ({ items: [card], available: true, automaticEnabled: false, timeZone: 'Asia/Shanghai', run: {status: 'completed'}, ...overrides });
const props = { userId: 'u1', busy: false, onSession: vi.fn(), fallback: <p>旧版建议</p> };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(noteDiscoveries.list).mockResolvedValue(list()); });
describe('discovery entry', () => {
 it('shows one finding first and expands at most three, with real source revisions', async () => {
  vi.mocked(noteDiscoveries.list).mockResolvedValue(list({items: Array.from({length: 4}, (_, i) => ({...card, id: String(i), title: `发现${i}`}))}));
  render(<NoteDiscoveryPanel {...props} />);
  await screen.findByRole('article', {name: '发现0'});
  expect(screen.queryByRole('article', {name: '发现1'})).toBeNull();
  fireEvent.click(screen.getByText('查看其他发现'));
  expect(screen.getAllByRole('article', {name: /发现/})).toHaveLength(3);
  expect(screen.getAllByText(/版本 3/)).toHaveLength(6);
 });
 it('adopts the server session without asking an opening question and blocks during stream', async () => {
  const session = {id: 'server', title: '发现', sourceMode: 'multi_note_discovery' as const, messages: [{role: 'assistant' as const, content: '已推进选中行动'}]};
  vi.mocked(noteDiscoveries.session).mockResolvedValue({session, reused: false});
  const view = render(<NoteDiscoveryPanel {...props} busy />);
  expect(await screen.findByText('继续探索')).toBeDisabled();
  view.rerender(<NoteDiscoveryPanel {...props} />);
  fireEvent.click(screen.getByText('继续探索'));
  await waitFor(() => expect(props.onSession).toHaveBeenCalledWith(session));
 });
 it('retains edited draft on failure and retries exactly the same operation; shows actual saved note', async () => {
  vi.mocked(noteDiscoveries.save).mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce({note: {_id:'saved-real'} as never, discovery: card});
  render(<NoteDiscoveryPanel {...props} />);
  fireEvent.click(await screen.findByText('编辑成果草稿'));
  fireEvent.change(screen.getByRole('textbox', {name: '成果草稿'}), {target: {value: '我确认的正文'}});
  fireEvent.click(screen.getByText('保存为新笔记'));
  await screen.findByText('保存失败');
  expect(screen.getByRole('textbox', {name: '成果草稿'})).toHaveValue('我确认的正文');
  fireEvent.click(screen.getByText('重试保存这份草稿'));
  await screen.findByText('查看已保存的笔记');
  expect(noteDiscoveries.save).toHaveBeenCalledTimes(2);
  expect(vi.mocked(noteDiscoveries.save).mock.calls[0]).toEqual(vi.mocked(noteDiscoveries.save).mock.calls[1]);
  expect(screen.getByText('查看已保存的笔记')).toHaveAttribute('href','/notes?highlight=saved-real');
 });
 it('does not hide cards or change preferences on rejected mutations; undo waits for server', async () => {
  vi.mocked(noteDiscoveries.feedback).mockRejectedValueOnce(new Error('反馈失败')).mockResolvedValueOnce({});
  vi.mocked(noteDiscoveries.preferences).mockRejectedValue(new Error('失败'));
  vi.mocked(noteDiscoveries.undo).mockRejectedValue(new Error('撤销失败'));
  render(<NoteDiscoveryPanel {...props} />);
  fireEvent.click(await screen.findByText('不感兴趣'));
  await screen.findByText('反馈失败');
  expect(screen.getByText('一个联系')).toBeInTheDocument();
  fireEvent.click(screen.getByText('自动发现：关闭'));
  await screen.findByText(/操作没有完成/);
  expect(screen.getByText('自动发现：关闭')).toBeInTheDocument();
  fireEvent.click(screen.getByText('不感兴趣'));
  await screen.findByText('已收起这条发现');
  fireEvent.click(screen.getByText('撤销'));
  await screen.findByText('撤销失败');
  expect(screen.getByText('已收起这条发现')).toBeInTheDocument();
 });
 it.each(['failed','no_result','budget_exhausted'] as const)('keeps enabled %s explicit without legacy fallback', async status => {
  vi.mocked(noteDiscoveries.list).mockResolvedValue(list({items: [], run:{status}}));
  render(<NoteDiscoveryPanel {...props} />);
  await screen.findByText(status === 'failed' ? '这次没有完成分析' : status === 'no_result' ? '暂时没有新的发现' : '发现额度暂时已用完');
  expect(screen.queryByText('旧版建议')).toBeNull();
 });
 it('uses fallback only when backend marks feature unavailable', async () => {
  vi.mocked(noteDiscoveries.list).mockResolvedValue(list({available: false}));
  render(<NoteDiscoveryPanel {...props} />);
  await screen.findByText('旧版建议');
 });
 it('rejects late data from a previous owner and cancels its request', async () => {
  let resolve!: (value: DiscoveryList) => void;
  vi.mocked(noteDiscoveries.list).mockImplementationOnce(() => new Promise(r => {resolve=r;}));
  const view = render(<NoteDiscoveryPanel {...props} />);
  const signal = vi.mocked(noteDiscoveries.list).mock.calls[0][0];
  vi.mocked(noteDiscoveries.list).mockResolvedValue(list({items:[], run:{status:'no_result'}}));
  view.rerender(<NoteDiscoveryPanel {...props} key="u2" userId="u2" />);
  await screen.findByText('暂时没有新的发现');
  await act(async () => resolve(list()));
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByText('一个联系')).toBeNull();
 });
});
