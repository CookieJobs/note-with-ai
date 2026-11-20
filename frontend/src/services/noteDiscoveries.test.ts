import { beforeEach, expect, it, vi } from 'vitest';
import { DiscoveryApiError, noteDiscoveries } from './noteDiscoveries';
const {authFetch}=vi.hoisted(()=>({authFetch:vi.fn()}));
vi.mock('../utils/auth',()=>({authFetch}));
beforeEach(()=>vi.clearAllMocks());
it('retains real source-stale409 codes and distinguishes a deleted saved target410', async()=>{
 for(const [status,code] of [[409,'DISCOVERY_STALE'],[410,'DISCOVERY_SAVED_NOTE_DELETED']] as const){
  authFetch.mockResolvedValueOnce({ok:false,status,json:async()=>({error:'真实服务错误',code})});
  await expect(noteDiscoveries.save('finding',{text:'确认',idempotencyKey:'same'})).rejects.toMatchObject({status,code});
 }
});
it('uses scheduling read-only GET by default and sends explicit initial visit and explicit retry intent only when requested',async()=>{
 authFetch.mockResolvedValue({ok:true,json:async()=>({data:{}})});
 await noteDiscoveries.list();expect(authFetch.mock.calls.at(-1)![0]).toContain('admit=false');
 await noteDiscoveries.list(undefined,false,true);expect(authFetch.mock.calls.at(-1)![0]).toContain('admit=true');
 await noteDiscoveries.session('finding','discovery-initial');
 expect(JSON.parse(authFetch.mock.calls.at(-1)![1].body)).toEqual({retryOfRequestId:'discovery-initial'});
});
it('never treats generic503 or an error code alone as eligibility to pay again',async()=>{
 authFetch.mockResolvedValue({ok:false,status:503,json:async()=>({error:'稍后再试',code:'CHAT_BUDGET_EXHAUSTED'})});
 await expect(noteDiscoveries.session('finding')).rejects.toMatchObject({retryEligible:false});
});
