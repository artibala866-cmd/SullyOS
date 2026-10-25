/** Per-Char manual WeChat generation preferences; defaults preserve old NPC chat behaviour. */
export type PhoneInboxPreferences={officialAccounts:boolean;paymentNotices:boolean;chatDensity:'compact'|'normal'|'rich'};
export const PHONE_INBOX_PREFS_CHANGED='sully:phone-inbox-prefs-changed';
const key=(id:string)=>'sully_character_phone_inbox_prefs_v1:'+id;
export function readPhoneInboxPreferences(id:string):PhoneInboxPreferences{
  try{
    const p=JSON.parse(localStorage.getItem(key(id))||'null');
    return {
      officialAccounts:p?.officialAccounts!==false,
      paymentNotices:p?.paymentNotices!==false,
      chatDensity:p?.chatDensity==='compact'||p?.chatDensity==='rich'?p.chatDensity:'normal',
    };
  }catch{return {officialAccounts:true,paymentNotices:true,chatDensity:'normal'};}
}
export function writePhoneInboxPreferences(id:string,patch:Partial<PhoneInboxPreferences>):PhoneInboxPreferences{
  const v={...readPhoneInboxPreferences(id),...patch};
  if(!id)throw Error('缺少角色');
  localStorage.setItem(key(id),JSON.stringify(v));
  window.dispatchEvent(new CustomEvent(PHONE_INBOX_PREFS_CHANGED,{detail:{characterId:id}}));
  return v;
}
