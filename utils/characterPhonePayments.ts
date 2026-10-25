/** Fictional WeChat Pay ledger generated from Char's phone actions; never a real transfer. */
export type PhonePayReceipt = {
  id:string;characterId:string;title:string;detail:string;category:string;
  amountCents:number;occurredAt:number;origin:'wechat-simulated'|'private-confirmed'|'market-confirmed';
  sourceId?:string;
};
export const PHONE_PAY_RECEIPTS_CHANGED='sully:character-phone-pay-receipts-changed';
const key=(id:string)=>'sully_character_phone_pay_receipts_v1:'+id;
const safe=(v:unknown,n=100)=>typeof v==='string'?v.trim().slice(0,n):'';
export function readPhonePayReceipts(charId:string):PhonePayReceipt[]{
  if(!charId||typeof localStorage==='undefined')return [];
  try{
    const parsed:unknown=JSON.parse(localStorage.getItem(key(charId))||'[]');
    return Array.isArray(parsed)?parsed.filter((r):r is PhonePayReceipt=>
      !!r&&r.characterId===charId&&typeof r.id==='string'&&
      Number.isSafeInteger(r.amountCents)&&r.amountCents!==0&&Math.abs(r.amountCents)<=50000000&&
      typeof r.title==='string'&&Number.isFinite(r.occurredAt)&&
      ['wechat-simulated','private-confirmed','market-confirmed'].includes(r.origin)).slice(0,300):[];
  }catch{return [];}
}
export function clearPhonePayReceipts(charId:string):void{
  localStorage.removeItem(key(charId));
  window.dispatchEvent(new CustomEvent(PHONE_PAY_RECEIPTS_CHANGED,{detail:{characterId:charId}}));
}
/** Only simulated everyday expense/refund rows, never an invented User-to-Char transfer. */
export function appendSimulatedPhonePayments(charId:string,payload:unknown,now=Date.now()):PhonePayReceipt[]{
  if(!charId||!Array.isArray(payload))return [];
  const previous=readPhonePayReceipts(charId);
  const next:PhonePayReceipt[]=[];
  for(const row of payload.slice(0,5)){
    if(!row||typeof row!=='object')continue;
    const obj=row as Record<string,unknown>;
    const title=safe(obj.title,70);
    // A refund is income and needs proof of the original payment; an AI batch
    // has none, so never mint speculative positive balances.
    const kind=obj.kind==='expense'?'expense':null;
    const amount=Number(obj.amount);
    if(!title||!kind||!Number.isFinite(amount)||amount<=0||amount>5000)continue;
    const amountCents=-Math.round(amount*100);
    if(!amountCents)continue;
    const category=safe(obj.category,32)||'微信支付';
    const detail=safe(obj.detail,220)||'角色微信支付的虚构账单';
    // Same merchant/amount/direction on the same day is treated as one
    // occurrence unless another explicit provenance is supplied later.
    const day=(v:number)=>new Date(v).toISOString().slice(0,10);
    if([...previous,...next].some(r=>r.origin==='wechat-simulated'&&
      day(r.occurredAt)===day(now)&&r.title===title&&r.amountCents===amountCents))continue;
    next.push({id:'wechat-pay:'+crypto.randomUUID(),characterId:charId,title,detail,category,
      amountCents,occurredAt:now-next.length*60000,origin:'wechat-simulated'});
  }
  if(!next.length)return [];
  localStorage.setItem(key(charId),JSON.stringify([...next,...previous].slice(0,300)));
  window.dispatchEvent(new CustomEvent(PHONE_PAY_RECEIPTS_CHANGED,{detail:{characterId:charId}}));
  return next;
}
/** Upstream integrations must supply an explicit unique source ID; no text guessing. */
export function appendConfirmedPhoneReceipt(input:Omit<PhonePayReceipt,'id'>):PhonePayReceipt|null{
  if(!input.sourceId||!input.characterId||!Number.isSafeInteger(input.amountCents)||
    !input.amountCents||Math.abs(input.amountCents)>50000000||
    !['private-confirmed','market-confirmed'].includes(input.origin))return null;
  const previous=readPhonePayReceipts(input.characterId);
  if(previous.some(p=>p.origin===input.origin&&p.sourceId===input.sourceId))return null;
  const item={...input,id:input.origin+':'+input.sourceId};
  localStorage.setItem(key(input.characterId),JSON.stringify([item,...previous].slice(0,300)));
  window.dispatchEvent(new CustomEvent(PHONE_PAY_RECEIPTS_CHANGED,{detail:{characterId:input.characterId}}));
  return item;
}
