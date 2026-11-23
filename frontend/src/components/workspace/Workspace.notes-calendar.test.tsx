import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceRoot from './WorkspaceRoot';
import { useWorkspace } from './WorkspaceContext';
import { beijingDate } from '../../app/notes/utils/noteFeed';
const mocks = vi.hoisted(() => ({ pathname: '/notes', fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../utils/auth', () => ({ getUser: () => ({ id:'calendar-user',username:'月历用户' }), authFetch: mocks.fetch, logout: vi.fn() }));
vi.mock('../../services/inspirationService', () => ({ getUnviewedInspirationCount: async () => 0 }));
vi.mock('../../hooks/useInspirationSettings', () => ({ useInspirationSettings: () => ({ settings:null,loading:false,saving:false,error:null,setEnabled:vi.fn() }) }));
function Probe() { const workspace=useWorkspace(); return <button onClick={() => workspace?.refreshNotesCalendar?.()}>模拟笔记写入成功</button>; }
beforeEach(() => {
  localStorage.clear(); mocks.pathname='/notes'; mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (url:string) => ({ ok:true,json:async()=>url.includes('/calendar') ? {success:true,data:{month:new URL(url,'http://localhost').searchParams.get('month'),timezone:'Asia/Shanghai',noteCount:2,recordedDayCount:1,days:[]}} : {success:true,data:{notes:[{_id:'recent',title:'其他页面的最近笔记'}]}} }));
  Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))});
});
it('replaces recent notes only inside the notes tab sidebar',async()=>{
  const view=render(<WorkspaceRoot><main>笔记正文</main></WorkspaceRoot>);
  const sidebar=screen.getByRole('complementary',{name:'工作区侧栏'});
  expect(await within(sidebar).findByRole('region',{name:'记录月历'})).toBeInTheDocument();
  expect(await within(sidebar).findByText('本月笔记')).toBeInTheDocument();
  expect(within(sidebar).queryByRole('region',{name:'最近笔记'})).not.toBeInTheDocument();
  expect(within(screen.getByRole('main')).queryByText('记录月历')).not.toBeInTheDocument();
  mocks.pathname='/inspiration';view.rerender(<WorkspaceRoot><main>灵感</main></WorkspaceRoot>);
  expect(await within(sidebar).findByRole('link',{name:'其他页面的最近笔记'})).toBeInTheDocument();
  expect(within(sidebar).queryByRole('region',{name:'记录月历'})).not.toBeInTheDocument();
});
it('refreshes sidebar calendar after notes write without resetting its selected month',async()=>{
  render(<WorkspaceRoot><Probe /></WorkspaceRoot>);
  fireEvent.click(await screen.findByRole('button',{name:'上个月'}));
  await waitFor(()=>expect(mocks.fetch.mock.calls.filter(([url])=>url.includes('/calendar'))).toHaveLength(2));
  const previous=mocks.fetch.mock.calls.at(-1)![0];
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'模拟笔记写入成功'})));
  await waitFor(()=>expect(mocks.fetch.mock.calls.at(-1)![0]).toBe(previous));
  expect(mocks.fetch.mock.calls.filter(([url])=>url.includes('/calendar'))).toHaveLength(3);
});

it('groups the month reset with the month arrows and returns to the current month', async () => {
  render(<WorkspaceRoot><Probe /></WorkspaceRoot>);
  const navigation = within(await screen.findByRole('group', { name: '月份切换' }));
  expect(navigation.queryByRole('button', { name: '回到本月' })).not.toBeInTheDocument();
  fireEvent.click(navigation.getByRole('button', { name: '上个月' }));
  await screen.findByText('当月笔记');
  expect(navigation.getByRole('button', { name: '下个月' })).toBeEnabled();
  fireEvent.click(navigation.getByRole('button', { name: '回到本月' }));
  expect(await screen.findByText('本月笔记')).toBeInTheDocument();
  expect(navigation.getByRole('button', { name: '下个月' })).toBeDisabled();
});

it('shows fixed heat levels for daily counts and marks today independently', async () => {
  const today = beijingDate();
  const month = today.slice(0, 7);
  const dates = ['01', '02', '03', '04', '05', '06', '07', '08']
    .map(day => `${month}-${day}`)
    .filter(date => date !== today);
  const counts = [0, 1, 2, 3, 4, 6, 7];
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {
    month, timezone: 'Asia/Shanghai', noteCount: 23, recordedDayCount: 6,
    days: dates.slice(1, counts.length).map((date, index) => ({ date, count: counts[index + 1] })),
  } }) });

  render(<WorkspaceRoot><main>笔记正文</main></WorkspaceRoot>);
  const calendar = await screen.findByRole('group', { name: `${month}记录日历` });
  const levels = [0, 1, 2, 2, 3, 3, 4];
  for (const [index, count] of counts.entries()) {
    const date = dates[index];
    const cell = within(calendar).getByTitle(`${date}，${count} 篇笔记`);
    expect(cell).toHaveAttribute('data-heat-level', String(levels[index]));
  }
  const current = within(calendar).getByTitle(`${today}，0 篇笔记`);
  expect(current).toHaveAttribute('aria-current', 'date');
  expect(current).toHaveAttribute('data-heat-level', '0');
});
