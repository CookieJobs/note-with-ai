import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import http, { type Server } from 'node:http';
import serverlessHandler, { createApp } from '../index';
import mongoose from 'mongoose';
import { beginNoteTitleRequestDeadline } from '../middleware/noteTitleRequestDeadline';
import User from '../models/User';
import { UserValidator } from '../utils/userValidation';
import { generateToken } from '../utils/jwt';
import { noteTitleSuggestionService } from '../services/noteTitleSuggestionService';

const requestId = '550e8400-e29b-41d4-a716-446655440000';
const payload = JSON.stringify({body:{kind:'plain-text',text:'draft'},clientRequestId:requestId});
const token = generateToken({userId:'507f1f77bcf86cd799439011',username:'test',email:'test@example.invalid'});

async function listen(deadlineMs: number): Promise<{server:Server;port:number}> {
  const server = createApp({noteTitleDeadlineMs:deadlineMs}).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {server,port:address.port};
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
function request(port: number, headers: Record<string,string> = {}, contentLength = Buffer.byteLength(payload)) {
  return http.request({host:'127.0.0.1',port,path:'/api/notes/title-suggestions',method:'POST',headers:{'content-type':'application/json','content-length':String(contentLength),...headers}});
}
function response(req: http.ClientRequest): Promise<{status:number;body:any}> {
  return new Promise((resolve,reject) => {
    req.once('error',reject);
    req.once('response',res=>{
      const chunks: Buffer[]=[];
      res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      res.once('end',()=>resolve({status:res.statusCode||0,body:JSON.parse(Buffer.concat(chunks).toString())}));
      res.once('error',reject);
    });
  });
}

describe('POST /api/notes/title-suggestions request boundary',()=>{
  afterEach(()=>mock.restoreAll());
  it('times out an incomplete body upload before auth or quota/provider work',async()=>{
    let authCalls=0, serviceCalls=0;
    mock.method(User,'findById',()=>{authCalls++;throw Error('auth entered');});
    mock.method(noteTitleSuggestionService,'suggest',async()=>{serviceCalls++;throw Error('service entered');});
    const {server,port}=await listen(35);
    try {
      const req=request(port,{},Buffer.byteLength(payload)+10);
      const received=response(req);
      req.write('{"body":');
      const result=await received;
      assert.equal(result.status,504);
      assert.equal(result.body.code,'NOTE_TITLE_GENERATION_TIMEOUT');
      assert.equal(authCalls,0);
      assert.equal(serviceCalls,0);
      req.destroy();
    } finally {await close(server);}
  });
  it('times out while authentication is unresolved, then ignores its late success',async()=>{
    let finishAuth!: (value:any)=>void;
    const pendingAuth=new Promise(resolve=>{finishAuth=resolve;});
    let serviceCalls=0;
    mock.method(User,'findById',()=>({select:()=>({lean:()=>pendingAuth})}) as any);
    mock.method(noteTitleSuggestionService,'suggest',async()=>{serviceCalls++;throw Error('service entered');});
    const {server,port}=await listen(35);
    try {
      const req=request(port,{authorization:`Bearer ${token}`});
      const received=response(req);
      req.end(payload);
      const result=await received;
      assert.equal(result.status,504);
      finishAuth({_id:'507f1f77bcf86cd799439011',isActive:true});
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(serviceCalls,0);
    } finally {await close(server);}
  });
  it('ignores a late authentication error after the deadline response',async()=>{
    let failAuth!: (reason:Error)=>void;
    const pendingAuth=new Promise((_resolve,reject)=>{failAuth=reject;});
    let serviceCalls=0;
    mock.method(User,'findById',()=>({select:()=>({lean:()=>pendingAuth})}) as any);
    mock.method(noteTitleSuggestionService,'suggest',async()=>{serviceCalls++;throw Error('service entered');});
    const {server,port}=await listen(35);
    try {
      const req=request(port,{authorization:`Bearer ${token}`});
      const received=response(req);
      req.end(payload);
      assert.equal((await received).status,504);
      failAuth(Error('late auth failure'));
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(serviceCalls,0);
    } finally {await close(server);}
  });
  it('does not write a late provider success after the boundary returned 504',async()=>{
    mock.method(User,'findById',()=>({select:()=>({lean:async()=>({_id:'507f1f77bcf86cd799439011',isActive:true})})}) as any);
    mock.method(UserValidator,'authenticateUser',async()=>({_id:{toString:()=> '507f1f77bcf86cd799439011'}}) as any);
    let finishProvider!: (value:any)=>void;
    let entered!: ()=>void;
    const enteredProvider=new Promise<void>(resolve=>{entered=resolve;});
    mock.method(noteTitleSuggestionService,'suggest',async()=>{
      entered();
      return new Promise(resolve=>{finishProvider=resolve;});
    });
    const {server,port}=await listen(35);
    try {
      const req=request(port,{authorization:`Bearer ${token}`});
      const received=response(req);
      req.end(payload);
      await enteredProvider;
      const result=await received;
      assert.equal(result.status,504);
      finishProvider({title:'late',clientRequestId:requestId,sourceFingerprint:'hash'});
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(result.body.code,'NOTE_TITLE_GENERATION_TIMEOUT');
    } finally {await close(server);}
  });
  it('ignores a late provider error after the deadline response',async()=>{
    mock.method(User,'findById',()=>({select:()=>({lean:async()=>({_id:'507f1f77bcf86cd799439011',isActive:true})})}) as any);
    mock.method(UserValidator,'authenticateUser',async()=>({_id:{toString:()=> '507f1f77bcf86cd799439011'}}) as any);
    let failProvider!: (reason:Error)=>void;
    let entered!: ()=>void;
    const enteredProvider=new Promise<void>(resolve=>{entered=resolve;});
    mock.method(noteTitleSuggestionService,'suggest',async()=>{
      entered();
      return new Promise((_resolve,reject)=>{failProvider=reject;});
    });
    const {server,port}=await listen(35);
    try {
      const req=request(port,{authorization:`Bearer ${token}`});
      const received=response(req);
      req.end(payload);
      await enteredProvider;
      assert.equal((await received).status,504);
      failProvider(Error('late provider failure'));
      await new Promise(resolve=>setTimeout(resolve,10));
    } finally {await close(server);}
  });
  it('keeps a serverless title 504 when Mongo connection rejects late, but propagates ordinary connection failure',async()=>{
    assert.equal(mongoose.connection.readyState,0);
    let rejectConnect!: (reason:Error)=>void;
    const pendingConnect=new Promise((_resolve,reject)=>{rejectConnect=reject;});
    let mode:'pending'|'reject'='pending';
    const ordinaryFailure=Error('ordinary connect failure');
    mock.method(mongoose,'connect',()=>mode==='pending'?pendingConnect as any:Promise.reject(ordinaryFailure) as any);
    const outcomes: unknown[]=[];
    const server=http.createServer((req,res)=>{
      beginNoteTitleRequestDeadline(35)(req as any,res as any,()=>undefined);
      void serverlessHandler(req as any,res as any).then(()=>{outcomes.push('resolved');},error=>{
        outcomes.push(error);
        if (!res.headersSent) {res.statusCode=500;res.end('connection failure');}
      });
    });
    await new Promise<void>(resolve=>server.listen(0,resolve));
    const address=server.address();
    assert.ok(address && typeof address!=='string');
    try {
      const titleReq=request(address.port,{authorization:`Bearer ${token}`});
      const titleResponse=response(titleReq);
      titleReq.end(payload);
      assert.equal((await titleResponse).status,504);
      rejectConnect(Error('late Mongo failure'));
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.deepEqual(outcomes,['resolved']);
      mode='reject';
      const ordinaryReq=http.request({host:'127.0.0.1',port:address.port,path:'/api/ping',method:'GET'});
      const ordinaryResponse=new Promise<number>((resolve,reject)=>{ordinaryReq.once('error',reject);ordinaryReq.once('response',res=>{res.resume();res.once('end',()=>resolve(res.statusCode||0));});});
      ordinaryReq.end();
      assert.equal(await ordinaryResponse,500);
      assert.equal(outcomes[1],ordinaryFailure);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve=>server.close(()=>resolve()));
      delete (globalThis as any).__mongoConnectPromise;
    }
  });

});
