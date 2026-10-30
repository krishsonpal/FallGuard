import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {identity} from './service.mjs';

const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createServer({service,devices,origins,checks,logger=entry=>console.info(JSON.stringify(entry))}) {
  const buckets=new Map();
  const routes={'/api/v1/events/phone-alert':'phone','/api/v1/windows':'device','/api/v1/events/cancel':'device','/api/v1/events/status':'device'};
  return http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    const url=new URL(req.url,'http://localhost');
    let reason='preflight';
    // Record only known route names and canonical origins. Never record query
    // strings, Authorization, body fields, contact IDs, or full request headers.
    let safeOrigin='none';
    if(origin){try{safeOrigin=new URL(origin).origin;}catch{safeOrigin='invalid';}}
    res.once('finish',()=>{
      if(routes[url.pathname]||res.statusCode>=400) {
        logger({event:'http',method:req.method,path:routes[url.pathname]?url.pathname:'other',origin:safeOrigin,status:res.statusCode,reason});
      }
    });
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const reply=(status,body)=>{reason=status<400?(body.status||'ok'):(body.code||'request_rejected');res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(origin&&!origins.includes(origin)) return reply(403,{error:'Origin not allowed',code:'origin_not_allowed'});
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.writeHead(204);res.end();return;
    }
    if(req.method==='GET'&&url.pathname==='/healthz') return reply(200,{status:'ready',model:checks});
    const role=routes[url.pathname];
    if(!role||req.method!=='POST') return reply(404,{error:'Unknown endpoint'});
    const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    const device=devices.find(d=>equal(bearer,d[`${role}_key`]));
    if(!device) return reply(401,{error:'Invalid device access key',code:'invalid_access_key'});
    const now=Date.now(), bucket=buckets.get(device.device_id)||{since:now,n:0};
    if(now-bucket.since>=60000){bucket.since=now;bucket.n=0;}
    buckets.set(device.device_id,bucket);
    if(++bucket.n>600) return reply(429,{error:'Device request limit reached'});
    try {
      if(!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(Error('JSON body required'),{status:415});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>32768)throw Object.assign(Error('Request body too large'),{status:413});chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}
      if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(Error('Object required'),{status:400});
      identity(body,device);
      if(['phone','device'].includes(role)&&['/api/v1/events/phone-alert','/api/v1/windows'].includes(url.pathname)&&req.headers['idempotency-key']!==body.event_key)throw Object.assign(Error('Idempotency-Key must match event_key'),{status:400});
      let result;
      if(url.pathname==='/api/v1/events/phone-alert') result=await service.phone(body,device);
      else if(url.pathname==='/api/v1/windows') result=await service.infer(body,device);
      else if(url.pathname==='/api/v1/events/cancel') result=service.cancel(body,device);
      else {result=service.existing(body.event_key);if(!result)throw Object.assign(Error('Unknown event'),{status:404});}
      const code=result.status==='failed'?503:result.status==='unknown'?409:200;
      // Contact/chat ID and keys never appear in responses.
      reply(code,result);
    } catch(error) {reply(error.status||500,{error:error.status?error.message:'Internal server error',code:error.message==='Device identity not authorized'?'device_id_mismatch':'request_rejected'});}
  });
}
