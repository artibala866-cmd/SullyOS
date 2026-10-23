import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import type { CharacterProfile } from '../types';
import {appendCharacterMemo,updateCharacterMemo,removeCharacterMemo,readCharacterMemos,type MemoCategory} from './characterPhoneMemos';
import type {CharacterLifeEvent} from './characterLifeEvents';
import {safeResponseJson,extractContent} from './safeApi';
type Api={baseUrl:string;apiKey:string;model:string};
const categories:MemoCategory[]=['thought','daily','expense','idea','about-user','unsent'];
const locks=new Set<string>();
const attempts=new Map<string,number>();
export async function considerCharacterMemo(input:{characterId:string;name:string;persona:string;api:Api;events:CharacterLifeEvent[];manual?:boolean;userName?:string;chatContext?:string;char?:Pick<CharacterProfile,'id'|'customTimezoneEnabled'|'customTimezone'>}):Promise<boolean>{
  const {characterId,name,persona,api}=input;
  const manual=!!input.manual;
  if(locks.has(characterId)||(!manual&&Date.now()-(attempts.get(characterId)||0)<60*60*1000))return false;
  if(!api.apiKey||!api.baseUrl||!api.model)return false;
  const history=readCharacterMemos(characterId);
  const used=new Set(history.flatMap(m=>m.sourceEventIds||[]));
  const events=input.events.filter(e=>!used.has(e.id)&&Date.now()-e.occurredAt<72*3600000).slice(0,6);
  if(!events.length&&!manual)return false;
  if(!manual&&history[0]&&Date.now()-history[0].createdAt<45*60*1000)return false;
  locks.add(characterId);attempts.set(characterId,Date.now());
  try{
  const life=input.char?.id===characterId ? await getCharacterLifeScheduleContext(input.char, new Date(), input.events) : null;
  const lifeHint=life ? '当前日程计划（并非已发生事实）：'+JSON.stringify({activity:life.plannedActivity,description:life.plannedDescription}).slice(0,600)+'。最近已确认生活事实：'+JSON.stringify(life.confirmedEvents.slice(0,12)).slice(0,3500)+'。' : '';
  const response=await fetch(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},body:JSON.stringify({model:api.model,stream:false,messages:[{role:'system',content:'你是角色的私人备忘录写作决策器。自动触发时可以选择什么都不写；手动触发时必须生成有效内容更新。记录是角色自己写给自己看的，不是发给User的，不是公开朋友圈。允许碎碎念、零散日常、开支、灵感、对User的观察、未说出口的话。严格遵守角色人设与已发生事件；不要捏造实际发生的转账、购买、承诺或聊天。手动更新必须真实改变笔记内容：可新增或根据真实聊天补充旧笔记，不得skip或delete，也不得仅改写措辞。没有足够新事实时可以增加符合角色人设的内心想法，但不要编造实际事件。优先更新已有笔记：已完成目标可更新状态，关于User的观察可追加变化，过时且无用的笔记可以删除。不得重新创建同样的笔记。输出纯JSON：{"action":"skip"}或{"action":"create","category":"thought|daily|expense|idea|about-user|unsent","title":"可选标题","body":"正文"}或{"action":"update","id":"已有笔记ID","body":"更新后的完整正文"}或{"action":"delete","id":"已有笔记ID"}。若是首次手动生成且没有旧笔记，可输出{"entries":[{"category":"thought","title":"","body":""}]}，2至4条不同类型；其他情况只执行一个动作。语言自然、不刻意煽情。角色：'+name+'。User称呼：'+(input.userName||'User')+'。设定：'+persona.slice(0,4000)},{role:'user',content:'这是'+(manual?'用户触发的备忘录内容更新检查；若为空且没有历史，先建立2-4条各有特色的初始记录，避免凭空捏造具体交易或已发生事件。':'自动生活事件触发。')+'真实私聊上下文：'+(input.chatContext||'暂无').slice(0,9000)+'。最近发生的事：'+JSON.stringify(events).slice(0,5000)+'。'+lifeHint+'近期备忘录：'+JSON.stringify(history.slice(0,12).map(m=>({id:m.id,category:m.category,title:m.title,body:m.body}))).slice(0,1500)}]})});
  const json=await safeResponseJson(response);if(!response.ok)throw new Error(json?.error?.message||'备忘录生成失败');
  const raw=extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const data=JSON.parse(raw);
  if(manual&&!history.length&&Array.isArray(data.entries)){
    let created=false;
    for(const entry of data.entries.slice(0,4))if(categories.includes(entry?.category)&&typeof entry.body==='string'&&entry.body.trim())created=!!appendCharacterMemo({characterId,category:entry.category,title:typeof entry.title==='string'?entry.title.slice(0,80):undefined,body:entry.body.slice(0,2400),private:true})||created;
    return created;
  }
  if(data.action==='delete'&&!manual&&typeof data.id==='string')return removeCharacterMemo(characterId,data.id);
  if(data.action==='update'&&typeof data.id==='string'&&typeof data.body==='string'&&data.body.trim()){
    const old=history.find(m=>m.id===data.id);if(old&&old.body.trim()!==data.body.trim())return updateCharacterMemo(characterId,data.id,{body:data.body.slice(0,2400),sourceEventIds:[...new Set([...(old.sourceEventIds||[]),...events.map(e=>e.id)])]});
  }
  if(data.action!=='create'||!categories.includes(data.category)||typeof data.body!=='string'||!data.body.trim()){
    if(manual)throw new Error('AI 未返回有效更新，未修改备忘录。请重试。');return false;
  }
  if(history.some(m=>m.body.trim()===data.body.trim())){if(manual)throw new Error('AI 返回了重复笔记，未保存。请重试。');return false;}
  return !!appendCharacterMemo({characterId,category:data.category,title:typeof data.title==='string'?data.title.slice(0,80):undefined,body:data.body.slice(0,2400),private:true,sourceEventIds:events.map(e=>e.id)});
  }finally{locks.delete(characterId);}
}
