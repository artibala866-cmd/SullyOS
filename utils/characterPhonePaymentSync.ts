/** Trust only DB transfer-card metadata: never parse free-text claims of payment. */
import type {Message} from '../types';
import {DB} from './db';
import {parseTransferAmount} from './transferFormat';
import {appendConfirmedPhoneReceipt,type PhonePayReceipt} from './characterPhonePayments';
export function syncPrivateTransferReceiptsFromMessages(charId:string,messages:Message[]):PhonePayReceipt[]{
  if(!charId)return [];
  const added:PhonePayReceipt[]=[];
  for(const m of messages.slice(-400)){
    if(m.charId!==charId||m.groupId||m.type!=='transfer'||
      (m.role!=='user'&&m.role!=='assistant')||
      m.metadata?.receipt||m.metadata?.status!=='accepted')continue;
    const amount=parseTransferAmount(m.metadata?.amount);
    if(amount===null||amount>500000)continue;
    const cents=Math.round(amount*100);
    if(!cents||!Number.isSafeInteger(cents))continue;
    const income=m.role==='user';
    const item=appendConfirmedPhoneReceipt({
      characterId:charId,origin:'private-confirmed',sourceId:'private-transfer:'+m.id,
      title:income?'User 的转账收款':'向 User 转账',category:'私聊转账',
      detail:'来自真实私聊记录的已确认转账卡片（仅同步查手机虚构账本）',
      amountCents:income?cents:-cents,occurredAt:Number.isFinite(m.timestamp)?m.timestamp:Date.now(),
    });
    if(item)added.push(item);
  }
  return added;
}
/** Called on Wallet entry/manual refresh; reads actual private messages, no new AI call. */
export async function syncConfirmedPrivatePhoneTransfers(charId:string):Promise<PhonePayReceipt[]>{
  const messages=await DB.getMessagesByCharId(charId,true);
  return syncPrivateTransferReceiptsFromMessages(charId,messages);
}
