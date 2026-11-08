import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceRoot from './WorkspaceRoot';
import { useWorkspace } from './WorkspaceContext';
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
