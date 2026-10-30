import {request as httpsRequest} from 'node:https';

// Scope IPv4 to Telegram only. HTTPS still uses the real hostname for DNS,
// certificate validation and SNI; no IP pinning, proxy, or insecure TLS bypass.
export function createTelegramFetch(requestImpl=httpsRequest) {
  return (url,options={})=>new Promise((resolve,reject)=>{
    const target=new URL(url);
    if(target.protocol!=='https:'||target.hostname!=='api.telegram.org'||target.username||target.password||
       (target.port&&target.port!=='443')||target.search||target.hash){
      reject(Error('Telegram transport requires the official HTTPS API host'));return;
    }
    const headers={...options.headers};
    if(options.body!==undefined)headers['Content-Length']=Buffer.byteLength(options.body);
    const request=requestImpl(target,{
      method:options.method||'GET',headers,signal:options.signal,
      family:4,autoSelectFamily:false,rejectUnauthorized:true,agent:false
    },response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>65536){response.destroy(Error('Telegram response exceeded size limit'));return;}
        chunks.push(chunk);
      });
      response.on('error',reject);
      response.on('aborted',()=>reject(Error('Telegram response ended prematurely')));
      response.on('end',()=>{
        if(response.complete===false){reject(Error('Telegram response was incomplete'));return;}
        const status=response.statusCode||0;
        const text=Buffer.concat(chunks).toString('utf8');
        resolve({status,ok:status>=200&&status<300,json:async()=>JSON.parse(text)});
      });
    });
    request.on('error',reject);
    request.end(options.body);
  });
}

export const fetchTelegramIPv4=createTelegramFetch();
