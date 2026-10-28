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

const activeGeneration=new Map<string,{users:number;timer:ReturnType<typeof setInterval>}>();
/** Maintain the lease throughout a long local tool/LLM round, even if AMSG2
 * is disabled. The independent NPC phone AI must not compete with *any*
 * private-chat generation. Multiple same-tab consumers share one heartbeat.
 */
export function beginLocalChatGenerationLease(charId:string):()=>void{
  if(!charId)return ()=>{};
  const existing=activeGeneration.get(charId);
  if(existing)existing.users++;
  else{
    const timer=setInterval(()=>touchLocalChatLease(charId),15_000);
    activeGeneration.set(charId,{users:1,timer});
  }
  touchLocalChatLease(charId);
  let stopped=false;
  return ()=>{
    if(stopped)return;
    stopped=true;
    const entry=activeGeneration.get(charId);
    if(!entry)return;
    entry.users--;
    if(entry.users<=0){
      clearInterval(entry.timer);
      activeGeneration.delete(charId);
    }
    // Keep the last heartbeat until TTL. A different tab may still be
    // actively generating and refresh the same key.
  };
}
