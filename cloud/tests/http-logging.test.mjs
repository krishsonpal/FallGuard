import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/http.mjs';
import {identity} from '../src/service.mjs';

test('request logs distinguish origin and identity denial without logging credentials or body',async()=>{
  const logs=[],secret='private-device-key-that-must-never-appear-in-logs';
  const device={device_id:'FallGuard-ESP32-demo',device_key:secret,phone_key:'other-private-phone-key'};
  const service={infer:async(body,d)=>{identity(body,d);return {status:'normal'};}};
  const server=createServer({service,devices:[device],origins:['https://allowed.example'],checks:{},logger:e=>logs.push(e)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(origin,body)=>fetch(base+'/api/v1/windows?secret=private-query-value',{
    method:'POST',headers:{Origin:origin,Authorization:`Bearer ${secret}`,'Content-Type':'application/json','Idempotency-Key':body.event_key||'unused'},body:JSON.stringify({...body,private_body:'private-body-value'})
  });
  try{
    let response=await post('https://blocked.example',{});
    assert.equal(response.status,403);assert.equal((await response.json()).code,'origin_not_allowed');
    response=await post('https://allowed.example',{device_id:'wrong'});
    assert.equal(response.status,403);assert.equal((await response.json()).code,'device_id_mismatch');
    assert.ok(logs.some(e=>e.reason==='origin_not_allowed'&&e.origin==='https://blocked.example'));
    assert.ok(logs.some(e=>e.reason==='device_id_mismatch'&&e.status===403));
    const output=JSON.stringify(logs);
    for(const value of [secret,'private-query-value','private-body-value','Authorization'])assert.ok(!output.includes(value));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
