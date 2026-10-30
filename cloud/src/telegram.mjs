const defaultLogger=entry=>console.info(JSON.stringify(entry));
const networkCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID']);
function transportReason(error) {
  if(error?.name==='TimeoutError'||error?.name==='AbortError')return {reason:'telegram_timeout'};
  const codes=[error?.code,error?.cause?.code,...(error?.cause?.errors||[]).map(e=>e?.code)].filter(code=>networkCodes.has(code));
  return {reason:'telegram_connection_failed',...(codes.length?{network_codes:[...new Set(codes)]}:{})};
}
async function callTelegram({token,operation,payload,fetchImpl,logger}) {
  let response;
  try {
    response=await fetchImpl(`https://api.telegram.org/bot${token}/${operation}`,{
      method:payload?'POST':'GET',...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{}),
      signal:AbortSignal.timeout(10000)
    });
  }catch(error){
    const report={status:'unknown',...transportReason(error)};
    logger({event:'telegram',operation,...report});return {report};
  }
  let body;
  try{body=await response.json();}catch{
    const report={status:'unknown',reason:'telegram_non_json_response',http_status:response.status};
    logger({event:'telegram',operation,...report});return {report};
  }
  if(body?.ok===false){
    const report={status:'failed',reason:'telegram_api_refused',http_status:response.status,
      ...(Number.isInteger(body.error_code)?{api_error_code:body.error_code}:{})};
    logger({event:'telegram',operation,...report});return {report};
  }
  return {response,body};
}

// This is read-only: getMe validates the configured bot and connection but does
// not send a message or change any pending event/delivery state.
export async function checkTelegram({token,fetchImpl=fetchTelegramIPv4,logger=defaultLogger}) {
  const result=await callTelegram({token,operation:'getMe',fetchImpl,logger});
  if(result.report)return result.report;
  const {response,body}=result;
  if(response.ok&&body?.ok===true&&body.result?.is_bot===true){
    const username=body.result.username;
    const report={status:'ready',...(typeof username==='string'&&/^[A-Za-z0-9_]{5,64}$/.test(username)?{bot_username:username}:{})};
    logger({event:'telegram',operation:'getMe',...report});return report;
  }
  const report={status:'unknown',reason:'telegram_unexpected_response',http_status:response.status};
  logger({event:'telegram',operation:'getMe',...report});return report;
}

export function telegramSender({token,dryRun,fetchImpl=fetchTelegramIPv4,logger=defaultLogger}) {
  if(!dryRun&&!token) throw Error('TELEGRAM_BOT_TOKEN is required unless DRY_RUN=true');
  return async (event,contact) => {
    if(dryRun) return {status:'simulated'};
    const text=`FallGuard demo: possible fall detected\nWearer: ${contact.wearer}\nDevice: ${event.device_id}\nDetected: ${new Date(event.detected_at).toISOString()}\nScore: ${event.score.toFixed(4)}\nRoute: ${event.route}\nNo cancellation received within 6 seconds. Please check on the wearer.\nEvent: ${event.event_key}`;
    const result=await callTelegram({token,operation:'sendMessage',payload:{chat_id:contact.chat_id,text},fetchImpl,logger});
    if(result.report)return result.report;
    const {response,body}=result;
    if(response.ok&&body?.ok===true&&Number.isInteger(body.result?.message_id)) {
      logger({event:'telegram',operation:'sendMessage',status:'sent'});
      return {status:'sent',message_id:body.result.message_id};
    }
    const report={status:'unknown',reason:'telegram_unexpected_response',http_status:response.status};
    logger({event:'telegram',operation:'sendMessage',...report});return report;
  };
}
import {fetchTelegramIPv4} from './telegram-transport.mjs';

