import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createTelegramFetch} from '../src/telegram-transport.mjs';

test('Telegram transport forces IPv4 while preserving HTTPS hostname/TLS and complete JSON response',async()=>{
  let calls=0;
  const fetchImpl=createTelegramFetch((url,options,callback)=>{
    calls++;assert.equal(url.hostname,'api.telegram.org');assert.equal(url.protocol,'https:');
    assert.equal(options.family,4);assert.equal(options.autoSelectFamily,false);assert.equal(options.rejectUnauthorized,true);
    assert.equal(options.headers['Content-Length'],Buffer.byteLength('{"text":"hello"}'));
    const request=new EventEmitter();
    request.end=body=>{assert.equal(body,'{"text":"hello"}');queueMicrotask(()=>{
      const response=new EventEmitter();response.statusCode=200;response.complete=true;callback(response);
      response.emit('data',Buffer.from('{"ok":true,"result":{"message_id":1}}'));response.emit('end');
    });};return request;
  });
  const response=await fetchImpl('https://api.telegram.org/bot123:fake/sendMessage',{method:'POST',body:'{"text":"hello"}'});
  assert.equal(calls,1);assert.equal(response.ok,true);assert.equal((await response.json()).result.message_id,1);
});

test('Telegram transport rejects unrelated hosts and propagates network failure without retrying',async()=>{
  let calls=0;
  const fetchImpl=createTelegramFetch(()=>{
    calls++;const request=new EventEmitter();
    request.end=()=>queueMicrotask(()=>request.emit('error',Object.assign(Error('unreachable'),{code:'ETIMEDOUT'})));
    return request;
  });
  await assert.rejects(fetchImpl('http://api.telegram.org/bot123:fake/getMe'),/official HTTPS/);assert.equal(calls,0);
  await assert.rejects(fetchImpl('https://unrelated.example/getMe'),/official HTTPS/);assert.equal(calls,0);
  await assert.rejects(fetchImpl('https://api.telegram.org/bot123:fake/getMe'),{code:'ETIMEDOUT'});assert.equal(calls,1);
});

test('Telegram transport does not turn an incomplete response into confirmed success',async()=>{
  const fetchImpl=createTelegramFetch((url,options,callback)=>{
    const request=new EventEmitter();request.end=()=>queueMicrotask(()=>{
      const response=new EventEmitter();response.statusCode=200;response.complete=false;callback(response);
      response.emit('data',Buffer.from('{"ok":true}'));response.emit('end');
    });return request;
  });
  await assert.rejects(fetchImpl('https://api.telegram.org/bot123:fake/getMe'),/incomplete/);
});
