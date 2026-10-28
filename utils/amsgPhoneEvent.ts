/** A cloud push becomes a Char-phone fact only AFTER it was persisted to
 * the canonical private chat. No duplicated phone dialogue and no fabricated
 * social action. Event identity follows provider messageId for inbox retries.
 */
import type {CharacterLifeEvent} from './characterLifeEvents';
import {isVerifiedXhsAction} from './amsgVerifiedXhs';
export function eventForDeliveredAmsg(input:{
  charId:string;messageId:string;source:string;messageType?:string|null;
  instant:boolean;timestamp:number;
}):CharacterLifeEvent|null{
  if(input.source!=='scheduled'||input.instant||!input.charId||!input.messageId
    ||!['auto','prompted'].includes(input.messageType||'')||!Number.isFinite(input.timestamp))return null;
  return {
    id:'amsg2:proactive:'+input.messageId,
    characterId:input.charId,
    kind:'proactive-message',
    source:'amsg2',occurredAt:input.timestamp,
    relatedMessageId:input.messageId,
    summary:'角色已经在私聊里主动联系了用户',
  };
}

/** A verified cloud tool only enters the existing life ledger after its
 * scheduled private message has been successfully persisted. */
export function eventsForVerifiedXhsActions(input:{
 charId:string;messageId:string;source:string;messageType?:string|null;
 instant:boolean;timestamp:number;verifiedActions?:unknown;
}):CharacterLifeEvent[]{
 if(input.source!=='scheduled'||input.instant||!input.charId||!input.messageId
  ||!['auto','prompted'].includes(input.messageType||'')
  ||!Number.isFinite(input.timestamp)||!Array.isArray(input.verifiedActions))return [];
 const labels:Record<string,string>={
  xhs_search:'角色实际通过小红书检索了笔记',
  xhs_browse:'角色实际浏览了小红书推荐内容',
  xhs_detail:'角色实际打开了一篇小红书笔记',
 };
 return [...new Set(input.verifiedActions.filter(isVerifiedXhsAction))].slice(0,3)
   .map(name=>({id:'amsg2:verified-xhs:'+input.messageId+':'+name,
     characterId:input.charId,kind:'browser-search' as const,source:'xiaohongshu' as const,
     occurredAt:input.timestamp,relatedMessageId:input.messageId,summary:labels[name]}));
}
