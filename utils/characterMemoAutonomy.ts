import {appendCharacterMemo,updateCharacterMemo,removeCharacterMemo,readCharacterMemos,type MemoCategory} from './characterPhoneMemos';
import type {CharacterLifeEvent} from './characterLifeEvents';
import {safeResponseJson,extractContent} from './safeApi';
type Api={baseUrl:string;apiKey:string;model:string};
const categories:MemoCategory[]=['thought','daily','expense','idea','about-user','unsent'];
const locks=new Set<string>();
const attempts=new Map<string,number>();
export async function considerCharacterMemo(input:{characterId:string;name:string;persona:string;api:Api;events:CharacterLifeEvent[]}):Promise<boolean>{
  const {characterId,name,persona,api}=input;
  if(locks.has(characterId)||Date.now()-(attempts.get(characterId)||0)<60*60*1000)return false;
  if(!api.apiKey||!api.baseUrl||!api.model)return false;
  const history=readCharacterMemos(characterId);
  const used=new Set(history.flatMap(m=>m.sourceEventIds||[]));
  const events=input.events.filter(e=>!used.has(e.id)&&Date.now()-e.occurredAt<72*3600000).slice(0,6);
  if(!events.length)return false;
  if(history[0]&&Date.now()-history[0].createdAt<45*60*1000)return false;
  locks.add(characterId);attempts.set(characterId,Date.now());
  try{
  const response=await fetch(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},body:JSON.stringify({model:api.model,stream:false,messages:[{role:'system',content:'你是角色的私人备忘录写作决策器。角色可以选择什么都不写。记录是角色自己写给自己看的，不是发给User的，不是公开朋友圈。允许碎碎念、零散日常、开支、灵感、对User的观察、未说出口的话。严格遵守角色人设与已发生事件；不要捏造实际发生的转账、购买、承诺或聊天。优先更新已有笔记：已完成目标可更新状态，关于User的观察可追加变化，过时且无用的笔记可以删除。不得重新创建同样的笔记。输出纯JSON：{"action":"skip"}或{"action":"create","category":"thought|daily|expense|idea|about-user|unsent","title":"可选标题","body":"正文"}或{"action":"update","id":"已有笔记ID","body":"更新后的完整正文"}或{"action":"delete","id":"已有笔记ID"}。只执行一个动作，语言自然、不刻意煽情。角色：'+name+'。设定：'+persona.slice(0,4000)},{role:'user',content:'最近发生的事：'+JSON.stringify(events).slice(0,5000)+'。近期备忘录：'+JSON.stringify(history.slice(0,12).map(m=>({id:m.id,category:m.category,title:m.title,body:m.body}))).slice(0,1500)}]})});
  const json=await safeResponseJson(response);if(!response.ok)throw new Error(json?.error?.message||'备忘录生成失败');
  const raw=extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const data=JSON.parse(raw);
  if(data.action==='delete'&&typeof data.id==='string')return removeCharacterMemo(characterId,data.id);
  if(data.action==='update'&&typeof data.id==='string'&&typeof data.body==='string'&&data.body.trim())return updateCharacterMemo(characterId,data.id,{body:data.body.slice(0,2400)});
  if(data.action!=='create'||!categories.includes(data.category)||typeof data.body!=='string'||!data.body.trim())return false;
  return !!appendCharacterMemo({characterId,category:data.category,title:typeof data.title==='string'?data.title.slice(0,80):undefined,body:data.body.slice(0,2400),private:true,sourceEventIds:events.map(e=>e.id)});
  }finally{locks.delete(characterId);}
}
