/**
 * Foreground private-chat generation presence, shared by tabs of the same
 * SullyOS origin. Only stores a short timestamp: no messages or prompts.
 * A stale browser window cannot reserve another channel indefinitely.
 */
const PREFIX='sully_chat_reply_active_v1:';
export const LOCAL_CHAT_LEASE_TTL_MS=45_000;
export function touchLocalChatLease(charId:string,now=Date.now()):void{
  if(!charId||!Number.isFinite(now)||typeof localStorage==='undefined')return;
  try{localStorage.setItem(PREFIX+charId,String(now));}catch{/* private mode */}
}
export function isLocalChatLeaseActive(charId:string,now=Date.now()):boolean{
  if(!charId||typeof localStorage==='undefined')return false;
  try{
    const at=Number(localStorage.getItem(PREFIX+charId));
    return at>0&&Number.isFinite(at)&&now>=at&&now-at<LOCAL_CHAT_LEASE_TTL_MS;
  }catch{return false;}
}
