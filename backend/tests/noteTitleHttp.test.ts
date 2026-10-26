import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { EventEmitter } from 'node:events';
import { suggestNoteTitle } from '../controllers/noteTitleSuggestionController';
import { noteTitleSuggestionService } from '../services/noteTitleSuggestionService';
import { UserValidator } from '../utils/userValidation';
import { Note } from '../models/Note';

const requestId = '550e8400-e29b-41d4-a716-446655440000';
function response() {
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.writableFinished = false;
  res.status = (code:number) => { res.statusCode=code; return res; };
  res.json = (value:unknown) => {res.body=value;res.writableFinished=true;return res;};
  return res;
}

describe('title suggestion HTTP controller', () => {
  afterEach(() => mock.restoreAll());
  it('authenticates and suggests only from submitted body without note lookup or write', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({_id:{toString:()=> 'account'}}) as never);
    mock.method(Note, 'findOne', async () => {throw Error('note lookup');});
    mock.method(Note, 'updateOne', async () => {throw Error('note write');});
    mock.method(noteTitleSuggestionService, 'suggest', async (input:any) => {
      assert.equal(input.userId, 'account');
      assert.equal(input.body.text, 'draft');
      return {title:'draft title',clientRequestId:input.clientRequestId,sourceFingerprint:'hash'};
    });
    const req = Object.assign(new EventEmitter(), {body:{body:{kind:'plain-text',text:'draft'},clientRequestId:requestId}}) as any;
    const res = response();
    await suggestNoteTitle(req,res);
    assert.equal(res.statusCode,200);
    assert.deepEqual(res.body.data,{title:'draft title',clientRequestId:requestId,sourceFingerprint:'hash'});
  });
  it('rejects extra authority fields before service', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({_id:{toString:()=> 'account'}}) as never);
    mock.method(noteTitleSuggestionService,'suggest',async()=>{throw Error('called');});
    const req = Object.assign(new EventEmitter(), {body:{body:{kind:'plain-text',text:'draft'},clientRequestId:requestId,noteId:'someone-else'}}) as any;
    await assert.rejects(suggestNoteTitle(req,response()),(error:any)=>error.details?.code==='NOTE_TITLE_INPUT_INVALID');
  });
  it('aborts the in-flight suggestion when the response closes early', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => ({_id:{toString:()=> 'account'}}) as never);
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    mock.method(noteTitleSuggestionService, 'suggest', async (input:any) => {
      started();
      await new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(Error('aborted')), {once:true}));
      throw Error('unreachable');
    });
    const req = Object.assign(new EventEmitter(), {body:{body:{kind:'plain-text',text:'draft'},clientRequestId:requestId}}) as any;
    const res = response();
    const pending = assert.rejects(suggestNoteTitle(req,res),/aborted/);
    await ready;
    res.emit('close');
    await pending;
  });
  it('does not enter suggestion service when authentication fails', async () => {
    mock.method(UserValidator, 'authenticateUser', async () => {throw Error('unauthenticated');});
    mock.method(noteTitleSuggestionService,'suggest',async()=>{throw Error('called');});
    const req = Object.assign(new EventEmitter(), {body:{body:{kind:'plain-text',text:'draft'},clientRequestId:requestId}}) as any;
    await assert.rejects(suggestNoteTitle(req,response()),/unauthenticated/);
  });
});
