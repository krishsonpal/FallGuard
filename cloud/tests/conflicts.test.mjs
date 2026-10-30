import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.mjs';
import {Service} from '../src/service.mjs';
import {createServer} from '../src/http.mjs';

const device={device_id:'FallGuard-ESP32-demo',wearer:'Demo',chat_id:'123',phone_key:'p'.repeat(40),device_key:'d'.repeat(40)};
function phone(id,now){return {device_id:device.device_id,boot_id:1,window_id:id,event_key:`${device.device_id}/00000001/${id.toString(16).padStart(8,'0')}`,route:'phone',score:0.9,detected_at:new Date(now-6000).toISOString(),cancel_deadline:new Date(now).toISOString()};}

test('separate positive events report cooldown then succeed after its exact boundary',async()=>{
  let now=100000;
  const store=new Store(':memory:',[device]);
  const service=new Service({store,clock:()=>now,send:async()=>({status:'simulated'})});
  try{
    assert.equal((await service.phone(phone(1,now),device)).status,'simulated');
    now=104000;
    await assert.rejects(service.phone(phone(2,now),device),{status:409,code:'episode_cooldown',retry_after_ms:6000,active_state:'simulated'});
    // Same-ID retries recover the original result without extending cooldown.
    assert.equal((await service.phone(phone(1,now),device)).status,'simulated');
    now=110000;
    assert.equal((await service.phone(phone(2,now),device)).status,'simulated');
  }finally{store.close();}
});

test('HTTP logs distinguish an unresolved delivery from cooldown without body/keys',async()=>{
  const now=100000,logs=[];
  const store=new Store(':memory:',[device]);
  const service=new Service({store,clock:()=>now,send:async()=>({status:'unknown'})});
  await service.phone(phone(1,now),device);
  const server=createServer({service,devices:[device],origins:[],checks:{},logger:e=>logs.push(e)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const b=phone(2,now);
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/events/phone-alert`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${device.phone_key}`,'Idempotency-Key':b.event_key},body:JSON.stringify(b)
    });
    assert.equal(r.status,409);
    const result=await r.json();assert.equal(result.code,'device_episode_active');assert.equal(result.active_state,'unknown');
    assert.ok(logs.some(e=>e.reason==='device_episode_active'&&e.active_state==='unknown'));
    assert.ok(!JSON.stringify(logs).includes(device.phone_key));
  }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
