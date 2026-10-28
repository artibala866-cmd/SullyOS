/** A cloud push becomes a Char-phone fact only AFTER it was persisted to
 * the canonical private chat. No duplicated phone dialogue and no fabricated
 * social action. Event identity follows provider messageId for inbox retries.
 */
import type {CharacterLifeEvent} from './characterLifeEvents';
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
