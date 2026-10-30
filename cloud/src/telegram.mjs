export function telegramSender({token,dryRun,fetchImpl=fetch}) {
  if(!dryRun&&!token) throw Error('TELEGRAM_BOT_TOKEN is required unless DRY_RUN=true');
  return async (event,contact) => {
    if(dryRun) return {status:'simulated'};
    const text=`FallGuard demo: possible fall detected\nWearer: ${contact.wearer}\nDevice: ${event.device_id}\nDetected: ${new Date(event.detected_at).toISOString()}\nScore: ${event.score.toFixed(4)}\nRoute: ${event.route}\nNo cancellation received within 6 seconds. Please check on the wearer.\nEvent: ${event.event_key}`;
    try {
      const response=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:contact.chat_id,text}),signal:AbortSignal.timeout(10000)
      });
      const body=await response.json();
      if(response.ok&&body.ok===true&&Number.isInteger(body.result?.message_id)) return {status:'sent',message_id:body.result.message_id};
      // An explicit API refusal is safe to retry. Ambiguous responses are not.
      return {status:body.ok===false?'failed':'unknown'};
    }catch{return {status:'unknown'};}
  };
}
