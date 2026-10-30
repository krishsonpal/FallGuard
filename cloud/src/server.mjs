import {Store} from './store.mjs';
import {Service} from './service.mjs';
import {loadModel} from './model.mjs';
import {telegramSender} from './telegram.mjs';
import {createServer} from './http.mjs';

const devices=JSON.parse(process.env.DEVICES_JSON||'[]');
if(!Array.isArray(devices)||devices.length===0||devices.length>20)throw Error('Configure 1 to 20 entries in DEVICES_JSON');
const keys=new Set(),ids=new Set();
for(const d of devices){
  if(typeof d.device_id!=='string'||!/^FallGuard-ESP32-[A-Za-z0-9_-]{1,40}$/.test(d.device_id)||ids.has(d.device_id))throw Error('Invalid or duplicate device_id');
  ids.add(d.device_id);
  if(typeof d.wearer!=='string'||!d.wearer||d.wearer.length>100||typeof d.chat_id!=='string'||!d.chat_id)throw Error('Configure wearer and chat_id');
  for(const field of ['phone_key','device_key']){const k=d[field];if(typeof k!=='string'||k.length<32||k.includes('REPLACE')||keys.has(k))throw Error('Use unique random access keys of 32+ characters');keys.add(k);}
}
const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
if(!origins.length||origins.includes('*'))throw Error('Configure explicit ALLOWED_ORIGINS');
const send=telegramSender({token:process.env.TELEGRAM_BOT_TOKEN,dryRun:process.env.DRY_RUN!=='false'});
const model=await loadModel();
const store=new Store(process.env.DB_PATH||'./data/fallguard.sqlite',devices);
const service=new Service({store,model,send});
const server=createServer({service,devices,origins,checks:model.checks});
server.requestTimeout=15000;server.headersTimeout=10000;
let running=false;
const timer=setInterval(async()=>{if(running)return;running=true;try{await service.tick();}catch{console.error('Event worker failed; inspect service state');}finally{running=false;}},100);
server.listen(Number(process.env.PORT||8080),process.env.HOST||'0.0.0.0',()=>console.log(`FallGuard ready; model checks=${model.checks.cases}; delivery=${process.env.DRY_RUN==='false'?'Telegram':'DRY RUN'}`));
async function stop(){clearInterval(timer);server.close();while(running||service.jobs.size)await new Promise(r=>setTimeout(r,20));store.close();model.close();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
