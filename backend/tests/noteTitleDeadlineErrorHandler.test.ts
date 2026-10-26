import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globalErrorHandler } from '../utils/errorHandler';

describe('global error handler after title deadline support',()=>{
  it('delegates an active partial response error to Express for stream termination',()=>{
    const failure=Error('stream failed');
    let passed:unknown, wrote=false;
    const response={headersSent:true,writableEnded:false,destroyed:false,status:()=>{wrote=true;return response;},json:()=>{wrote=true;}};
    globalErrorHandler(failure,{method:'GET',path:'/api/chat'} as any,response as any,(error:unknown)=>{passed=error;});
    assert.equal(passed,failure);
    assert.equal(wrote,false);
  });
  it('suppresses late errors after a completed or destroyed deadline response',()=>{
    const failure=Error('late failure');
    for (const state of [{headersSent:true,writableEnded:true,destroyed:false},{headersSent:true,writableEnded:false,destroyed:true}]) {
      let forwarded=false,wrote=false;
      const response={...state,status:()=>{wrote=true;return response;},json:()=>{wrote=true;}};
      globalErrorHandler(failure,{method:'POST',path:'/api/notes/title-suggestions'} as any,response as any,()=>{forwarded=true;});
      assert.equal(forwarded,false);
      assert.equal(wrote,false);
    }
  });
});
