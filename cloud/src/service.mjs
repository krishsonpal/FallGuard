const fail = (message,status=400) => {throw Object.assign(Error(message),{status});};
const hex = n => n.toString(16).padStart(8,'0');
export function identity(body, device) {
  if (body.device_id !== device.device_id) fail('Device identity not authorized',403);
  for (const field of ['boot_id','window_id']) if (!Number.isInteger(body[field]) || body[field]<0 || body[field]>0xffffffff) fail(`Invalid ${field}`);
  const key = `${device.device_id}/${hex(body.boot_id)}/${hex(body.window_id)}`;
  if (body.event_key !== key) fail('event_key does not match device/boot/window');
  return key;
}
export class Service {
  constructor({store, model, send, clock=()=>Date.now()}) {Object.assign(this,{store,model,send,clock}); this.jobs=new Map();}
  view(e) {return {...e,remaining_ms:e.status==='pending'?Math.max(0,e.deadline-this.clock()):0,threshold:0.44};}
  existing(key) {const e=this.store.get(key);return e?this.view(e):null;}
  async infer(body,device) {
    const key=identity(body,device), known=this.existing(key);
    if (known) return known;
    const captured=body.captured_at_ms, received=this.clock();
    if(typeof captured!=='number'||!Number.isFinite(captured)||captured>received+5000||received-captured>30000) fail('Fresh captured_at_ms required (maximum age 30 seconds)');
    const other=this.store.active(device.device_id)||this.store.recent(device.device_id,this.clock());
    if (other) fail(`Device already has episode ${other.event_key}`,409);
    if (body.sample_hz!==50 || body.units!=='m/s2,rad/s') fail('Expected 50 Hz and units m/s2,rad/s');
    // Prediction is synchronous on CPU, so no other request can open an episode mid-inference.
    const score=this.model.predict(body.samples), now=this.clock();
    return this.view(this.store.insert({event_key:key,device_id:device.device_id,boot_id:body.boot_id,window_id:body.window_id,route:'cloud',score,detected_at:now,deadline:score>=0.44?now+6000:now,status:score>=0.44?'pending':'normal'}));
  }
  cancel(body,device) {
    const key=identity(body,device), e=this.store.get(key);
    if (!e) fail('Unknown event',404);
    if(e.route!=='cloud') fail('Phone owns cancellation for this event',409);
    if(e.status==='cancelled') return this.view(e);
    if(e.status!=='pending'||this.clock()>=e.deadline) fail('Cancellation deadline elapsed or event resolved',409);
    return this.view(this.store.update(key,'cancelled',this.clock()));
  }
  async phone(body,device) {
    const key=identity(body,device);
    if(body.route!=='phone'||typeof body.score!=='number'||!Number.isFinite(body.score)||body.score<0.44||body.score>1) fail('Invalid positive phone result');
    const detected=Date.parse(body.detected_at), deadline=Date.parse(body.cancel_deadline), now=this.clock();
    if(!Number.isFinite(detected)||deadline-detected!==6000||deadline>now) fail('Phone countdown has not elapsed or timestamps invalid');
    let e=this.store.get(key);
    if(!e) {
      const other=this.store.active(device.device_id)||this.store.recent(device.device_id,now);
      if(other) fail(`Device already has episode ${other.event_key}`,409);
      e=this.store.insert({event_key:key,device_id:device.device_id,boot_id:body.boot_id,window_id:body.window_id,route:'phone',score:body.score,detected_at:detected,deadline,status:'pending'});
    }
    if(e.status==='cancelled'||e.status==='normal'||e.deadline>now) fail('Event is cancelled, normal, or still pending',409);
    return this.dispatch(key);
  }
  async dispatch(key) {
    if(this.jobs.has(key)) return this.jobs.get(key);
    const job=this.deliver(key); this.jobs.set(key,job);
    try{return await job;}finally{this.jobs.delete(key);}
  }
  async deliver(key) {
    const e=this.store.get(key);
    if(['sent','simulated','unknown','cancelled','normal'].includes(e.status)) return this.view(e);
    if(e.deadline>this.clock()) return this.view(e);
    const contact=this.store.contact(e.device_id);
    if(!contact) fail('No contact configured',503);
    this.store.update(key,'sending',this.clock());
    let result;
    try{result=await this.send(e,contact);}catch{result={status:'unknown'};}
    if(!['sent','simulated','failed','unknown'].includes(result.status)) result={status:'unknown'};
    return this.view(this.store.update(key,result.status,this.clock(),result.message_id?.toString()||null));
  }
  async tick() {for(const e of this.store.due(this.clock())) await this.dispatch(e.event_key);}
}
