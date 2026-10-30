import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTelegram,telegramSender} from '../src/telegram.mjs';
const token='123456:private_token_not_for_logs';

test('startup probe uses only getMe and reports bot identity without tokens',async()=>{
  const logs=[];let requests=0;
  const result=await checkTelegram({token,logger:e=>logs.push(e),fetchImpl:async(url,options)=>{
    requests++;assert.ok(url.endsWith('/getMe'));assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    return {ok:true,status:200,json:async()=>({ok:true,result:{is_bot:true,username:'FallGuardEmergencyBot'}})};
  }});
  assert.equal(requests,1);assert.equal(result.status,'ready');assert.equal(result.bot_username,'FallGuardEmergencyBot');assert.ok(!JSON.stringify(logs).includes(token));
});

test('Telegram refusal and non-JSON upstream responses have distinct safe diagnostics',async()=>{
  const logs=[];
  let result=await checkTelegram({token,logger:e=>logs.push(e),fetchImpl:async()=>({ok:false,status:401,json:async()=>({ok:false,error_code:401,description:token})})});
  assert.equal(result.status,'failed');assert.equal(result.reason,'telegram_api_refused');assert.equal(result.api_error_code,401);
  result=await checkTelegram({token,logger:e=>logs.push(e),fetchImpl:async()=>({ok:false,status:502,json:async()=>{throw Error(token);}})});
  assert.equal(result.status,'unknown');assert.equal(result.reason,'telegram_non_json_response');assert.equal(result.http_status,502);
  assert.ok(!JSON.stringify(logs).includes(token));
});

test('transport exceptions never log token-bearing URL/messages and remain unknown',async()=>{
  const logs=[];
  const error=Object.assign(Error('https://api.telegram.org/bot'+token+'/getMe'),{cause:{code:'ENOTFOUND'}});
  let result=await checkTelegram({token,logger:e=>logs.push(e),fetchImpl:async()=>{throw error;}});
  assert.equal(result.status,'unknown');assert.deepEqual(result.network_codes,['ENOTFOUND']);
  result=await checkTelegram({token,logger:e=>logs.push(e),fetchImpl:async()=>{throw Object.assign(Error(token),{name:'TimeoutError'});}});
  assert.equal(result.reason,'telegram_timeout');assert.ok(!JSON.stringify(logs).includes(token));
});

test('send timeout is logged once and never retried automatically by sender',async()=>{
  let calls=0;const logs=[];
  const send=telegramSender({token,dryRun:false,logger:e=>logs.push(e),fetchImpl:async()=>{calls++;throw Object.assign(Error(token),{name:'TimeoutError'});}});
  const result=await send({device_id:'device',event_key:'event',detected_at:1000,score:0.9,route:'phone'},{wearer:'Demo',chat_id:'123'});
  assert.equal(calls,1);assert.equal(result.status,'unknown');assert.equal(result.reason,'telegram_timeout');assert.equal(logs[0].operation,'sendMessage');assert.ok(!JSON.stringify(logs).includes(token));
});
