/**
 * Optional phone events returned INSIDE the regular Char/User completion.
 * Never calls an LLM. Used by both local reply post-processing and cloud inbox
 * flush (provided the cloud reply preserves the sidecar).
 */
import {readPhoneAutonomyPreferences} from './characterPhoneApiBudget';
import {readNpcProfiles} from './characterPhoneNpcs';
import {readCharacterPhoneChats,appendCharacterPhoneMessages} from './characterPhoneChats';
import {readCharacterMoments,publishCharacterMoment,addMomentComment} from './characterPhoneMoments';
import {recordCharacterLifeEvent} from './characterLifeEvents';
import {allowMomentComment} from './momentInteractionPreferences';

const OPEN='<sully_phone_events>',CLOSE='</sully_phone_events>';
const KEY=(charId:string)=>'sully_chat_phone_event_applied_v1:'+charId;
const compact=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const fingerprint=(text:string)=>{
 let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return(hash>>>0).toString(36);
};
export function extractChatPhoneEvents(raw:string):{cleaned:string;data:unknown|null}{
 let data:unknown=null;
 const cleaned=raw.replace(/<sully_phone_events>([\s\S]*?)<\/sully_phone_events>/gi,(_all,payload:string)=>{
  if(!data&&payload.length<=9000){try{data=JSON.parse(payload);}catch{/* ignore malformed JSON */}}
  return '';
 }).replace(/<sully_phone_events>[\s\S]*$/i,'').trim();
 return {cleaned,data};
}
export function chatPhonePiggybackPrompt(charId:string):string{
 if(!readPhoneAutonomyPreferences(charId).chatPiggybackEnabled)return '';
 const npcs=readNpcProfiles(charId).slice(0,14),conversations=readCharacterPhoneChats(charId).slice(0,8);
 return `
【可选：查手机与本次私聊同轮生成，不单独发 API】
正常直接回复 User；只有在这轮真实聊天激起 Char 很自然的社交冲动时，才在最终回复末尾额外输出一个内部 <sully_phone_events>JSON</sully_phone_events> 块。没合理动机就完全不输出该块。
严禁把标签或 JSON 解释给 User，也不要影响日常聊天语气与行动自由。这些是虚构角色的手机内容，不是 User 主动操作。
必须使用下面已确立的稳定联系人 ID，不可编造新 NPC，不可对 User 伪造私聊，不可从计划日程断言已发生事件。
已知 NPC：${JSON.stringify(npcs.map(n=>({id:n.id,name:n.name,relationship:n.relationship,personality:n.personality,speechStyle:n.speechStyle}))).slice(0,3400)}
最近 NPC 微信：${JSON.stringify(conversations.map(c=>({id:c.contactId,recent:c.messages.slice(-3).map(m=>({role:m.speaker.role,text:m.text.slice(0,80)}))}))).slice(0,1600)}
结构（在有自然动机时才输出，纯 JSON，不能用 Markdown 代码块）：
<sully_phone_events>{"chats":[{"contactId":"已存在NPC的ID","messages":[{"speaker":"owner","text":"Char自然发出的一条微信"},{"speaker":"contact","text":"NPC根据其原设回复的一条微信"}]}],"moment":{"publish":false,"text":"","comments":[{"authorId":"已知NPC的ID","text":"贴合人物的评论"}]}}</sully_phone_events>
chats 至多 1 个会话、至多 4 个气泡；NPC 回复可缺席、也可冷淡。moment 可不发，且必须有当前已发生的事实与性格动机；Char 朋友圈发布不等同于把 User 私聊公开。NPC 对刚发布的 Char 动态至多留 2 条认识彼此的人物评论，禁止套路赞美、无限接龙或重复文字。不能强行填满这些数组。
同轮只增加最终回答 token，不调用独立模型；不要连续在每条回复重复发社交事件。
`;
}
export function applyChatPhoneEvents(charId:string,raw:unknown,now=Date.now()):number{
 if(!charId||!readPhoneAutonomyPreferences(charId).chatPiggybackEnabled||!raw||typeof raw!=='object'||Array.isArray(raw))return 0;
 const value=raw as {chats?:unknown;moment?:unknown};
 const contacts=readNpcProfiles(charId), known=new Set(contacts.map(x=>x.id));
 let serialized='';try{serialized=JSON.stringify(value)}catch{return 0}
 if(serialized.length>9000)return 0;
 const hash=fingerprint(serialized);
 let history:Array<{hash:string;time:number}>=[];
 try{const parsed=JSON.parse(localStorage.getItem(KEY(charId))||'[]');if(Array.isArray(parsed))history=parsed.filter(x=>x&&typeof x.hash==='string'&&Number.isFinite(x.time)&&now-x.time<86400000);}catch{}
 if(history.some(x=>x.hash===hash))return 0;
 let changed=0;
 for(const item of (Array.isArray(value.chats)?value.chats:[]).slice(0,1)){
  const contact=contacts.find(x=>x.id===item?.contactId);
  if(!contact||!Array.isArray(item?.messages))continue;
  const messages=item.messages.slice(0,4).flatMap((entry:unknown)=>{
   if(!entry||typeof entry!=='object')return [];
   const r=entry as {speaker?:unknown;text?:unknown};
   const text=compact(r.text,350);
   if(!text||!['owner','contact'].includes(String(r.speaker)))return [];
   return [{speaker:r.speaker==='owner'?{role:'owner' as const}:{role:'contact' as const,contactId:contact.id},text,createdAt:now}];
  });
  if(!messages.length)continue;
  const added=appendCharacterPhoneMessages({characterId:charId,contactId:contact.id,contactName:contact.remark||contact.nickname||contact.name,messages,at:now});
  if(added?.added.length){
   changed+=added.added.length;
   try{recordCharacterLifeEvent({id:'npc-chat:piggyback:'+added.thread.id+':'+now,characterId:charId,
      kind:'npc-chat',occurredAt:now,source:'phone',contactId:contact.id,
      summary:'本次私聊之后的微信互动：'+added.added.map(x=>x.text).join('；').slice(0,650)});}catch{}
  }
 }
 const moment=(value.moment&&typeof value.moment==='object')?value.moment as {publish?:unknown;text?:unknown;comments?:unknown}:null;
 if(moment?.publish===true){
  const text=compact(moment.text,900),old=readCharacterMoments(charId);
  if(text&&!old.some(p=>p.authorId===charId&&!p.deletedAt&&(p.text.trim()===text||now-p.createdAt<12*3600_000))){
   const post=publishCharacterMoment({characterId:charId,origin:'char',text,imageUrls:[],visibility:'all'});
   if(post){
    changed++;
    try{recordCharacterLifeEvent({id:'moment:'+post.id,characterId:charId,kind:'moment-post',
      occurredAt:post.createdAt,source:'phone',summary:'Char 自主发布朋友圈：'+text.slice(0,100)});}catch{}
    for(const c of (Array.isArray(moment.comments)?moment.comments:[]).slice(0,2)){
     if(!known.has(c?.authorId))continue;
     const comment=compact(c.text,220),live=readCharacterMoments(charId).find(x=>x.id===post.id);
     if(!allowMomentComment(live?.comments||[],c.authorId,comment))continue;
     if(addMomentComment(charId,post.id,{id:crypto.randomUUID(),authorId:c.authorId,text:comment,createdAt:now}))changed++;
    }
   }
  }
 }
 try{localStorage.setItem(KEY(charId),JSON.stringify([...history,{hash,time:now}].slice(-80)));}catch{}
 return changed;
}
