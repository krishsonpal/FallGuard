import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {Service} from '../src/service.mjs';
import {telegramSender} from '../src/telegram.mjs';
import {createServer} from '../src/http.mjs';
const device={device_id:'FallGuard-ESP32-123456',wearer:'Demo',chat_id:'123',phone_key:'p'.repeat(40),device_key:'d'.repeat(40)};
const body=(id=1)=>({device_id:device.device_id,boot_id:10,window_id:id,event_key:`${device.device_id}/0000000a/${id.toString(16).padStart(8,'0')}`,captured_at_ms:100000,sample_hz:50,units:'m/s2,rad/s',samples:Array(750).fill(0)});
function setup(score=0.9){let now=100000,calls=0;const store=new Store(':memory:',[device]);const service=new Service({store,model:{predict:()=>score},clock:()=>now,send:async()=>{calls++;return {status:'sent',message_id:123};}});return {service,store,set:v=>{now=v;},calls:()=>calls};}
test('cloud timer expires independently; overlapping windows and duplicates do not restart it',async()=>{
  const f=setup();try{const e=await f.service.infer(body(),device);assert.equal(e.remaining_ms,6000);f.set(102000);assert.equal((await f.service.infer(body(),device)).remaining_ms,4000);await assert.rejects(f.service.infer(body(2),device),{status:409});await f.service.tick();assert.equal(f.calls(),0);f.set(106000);await Promise.all([f.service.tick(),f.service.tick()]);assert.equal(f.calls(),1);assert.equal(f.service.existing(e.event_key).status,'sent');await f.service.tick();assert.equal(f.calls(),1);}finally{f.store.close();}
});
test('cancellation is accepted strictly before deadline and never from phone route',async()=>{
  const f=setup();try{await f.service.infer(body(),device);f.set(105999);assert.equal(f.service.cancel(body(),device).status,'cancelled');f.set(200000);await f.service.tick();assert.equal(f.calls(),0);await f.service.infer({...body(2),captured_at_ms:200000},device);f.set(206000);assert.throws(()=>f.service.cancel(body(2),device),{status:409});await f.service.tick();assert.equal(f.calls(),1);}finally{f.store.close();}
});
test('normal scores do not start a timer',async()=>{const f=setup(0.4399999976);try{assert.equal((await f.service.infer(body(),device)).status,'normal');f.set(200000);await f.service.tick();assert.equal(f.calls(),0);}finally{f.store.close();}});
test('old or missing capture time cannot create a new cloud timer; existing event still recovers',async()=>{const f=setup();try{await assert.rejects(f.service.infer({...body(),captured_at_ms:undefined},device),{status:400});await assert.rejects(f.service.infer({...body(),captured_at_ms:69999},device),{status:400});await assert.rejects(f.service.infer({...body(),captured_at_ms:105001},device),{status:400});await f.service.infer(body(),device);f.set(200000);assert.equal((await f.service.infer(body(),device)).event_key,body().event_key);}finally{f.store.close();}});
test('phone alerts require elapsed six seconds; concurrent retries send once',async()=>{
  const f=setup();const b={...body(),route:'phone',score:0.9,detected_at:new Date(100000).toISOString(),cancel_deadline:new Date(106000).toISOString()};
  try{await assert.rejects(f.service.phone(b,device),{status:400});f.set(106000);const a=await Promise.all([f.service.phone(b,device),f.service.phone(b,device)]);assert.equal(f.calls(),1);assert.ok(a.every(x=>x.status==='sent'));assert.throws(()=>f.service.cancel(b,device),{status:409});}finally{f.store.close();}
});
test('same event transferred from cloud to phone cannot bypass cloud cancellation deadline',async()=>{const f=setup();try{await f.service.infer(body(),device);const b={...body(),route:'phone',score:0.9,detected_at:new Date(80000).toISOString(),cancel_deadline:new Date(86000).toISOString()};await assert.rejects(f.service.phone(b,device),{status:409});assert.equal(f.calls(),0);}finally{f.store.close();}});
test('restart recovers due cloud timer; uncertain sends never automatically repeat',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'fallguard-test-')),path=join(directory,'test.db');let store;
  try{store=new Store(path,[device]);const f=new Service({store,model:{predict:()=>0.9},send:async()=>({status:'sent'}),clock:()=>100000});await f.infer(body(),device);store.close();store=new Store(path,[device]);let calls=0;const recovered=new Service({store,clock:()=>106001,send:async()=>{calls++;return {status:'unknown'};}});await recovered.tick();await recovered.tick();assert.equal(calls,1);assert.equal(store.get(body().event_key).status,'unknown');store.update(body().event_key,'sending',106002);store.close();store=new Store(path,[device]);assert.equal(store.get(body().event_key).status,'unknown');}finally{store?.close();rmSync(join(directory,'test.db'),{force:true});rmSync(join(directory,'test.db-wal'),{force:true});rmSync(join(directory,'test.db-shm'),{force:true});rmdirSync(directory);}
});
test('Telegram dry run never calls network; API rejection differs from ambiguous timeout',async()=>{
  const e={...body(),score:0.9,detected_at:100000,route:'cloud'};let calls=0;
  assert.equal((await telegramSender({dryRun:true,fetchImpl:()=>{calls++;}})(e,device)).status,'simulated');assert.equal(calls,0);
  assert.equal((await telegramSender({token:'test',dryRun:false,fetchImpl:async()=>({ok:false,json:async()=>({ok:false})})})(e,device)).status,'failed');
  assert.equal((await telegramSender({token:'test',dryRun:false,fetchImpl:async()=>{throw Error('timeout');}})(e,device)).status,'unknown');
});
test('HTTP validates authorization, origin, device, and idempotency before dispatch',async()=>{
  const f=setup(),server=createServer({service:f.service,devices:[device],origins:['https://demo.example'],checks:{cases:6}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  const post=(body,headers={})=>fetch(url+'/api/v1/windows',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${device.device_key}`,'Idempotency-Key':body.event_key,...headers},body:JSON.stringify(body)});
  try{assert.equal((await post(body(),{Authorization:'Bearer wrong'})).status,401);assert.equal((await post(body(),{Origin:'https://evil.example'})).status,403);assert.equal((await post(body(),{'Idempotency-Key':'wrong'})).status,400);assert.equal((await post({...body(),device_id:'other'})).status,403);const response=await post(body(),{Origin:'https://demo.example'});assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://demo.example');assert.equal((await response.json()).remaining_ms,6000);assert.equal((await post({...body(),event_key:null})).status,400);}finally{await new Promise(r=>server.close(r));f.store.close();}
});

