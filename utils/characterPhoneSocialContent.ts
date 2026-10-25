/** Per-character / per-platform AI-generated fictional social snapshots. No real-platform activity. */
import type { CharacterProfile,UserProfile,GroupProfile,RealtimeConfig } from '../types';
import {buildCharacterPhoneContext} from './characterPhoneContext';
import {loadCharacterContextMessages} from './chatContextRange';
import {getCharacterLifeScheduleContext} from './characterLifeScheduleContext';
import {readNpcProfiles} from './characterPhoneNpcs';
import {readCharacterPhoneInstallPlan} from './characterPhoneAppInstall';
import {resolveCharacterPhoneApi} from './characterPhoneApiConfig';
import {safeResponseJson,extractContent} from './safeApi';

export type SocialContentApp='weibo'|'instagram';
export type SocialComment={id:string;authorName:string;content:string;charReply?:string;knownNpc:boolean};
export type SocialPost={id:string;text:string;topic?:string;visual?:string;likes:number;comments:SocialComment[]};
export type SocialViewed={id:string;authorName:string;text:string;topic?:string;visual?:string;charComment?:string};
export type SocialSnapshot={characterId:string;appId:SocialContentApp;profile:{handle:string;bio:string};posts:SocialPost[];viewed:SocialViewed[];generatedAt:number};
export const SOCIAL_SNAPSHOT_CHANGED='sully:character-phone-social-snapshot-changed';
const prefix='sully_character_phone_social_snapshot_v1:';
const inFlight=new Map<string,Promise<SocialSnapshot>>();
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const txt=(v:unknown,max=300)=>typeof v==='string'?v.replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,max):'';
const limitNum=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(99999,Math.floor(v))):0;
const storeKey=(id:string,app:SocialContentApp)=>prefix+id+':'+app;

export function normalizeSocialSnapshot(charId:string,appId:SocialContentApp,source:unknown,npcNames:string[],now=Date.now()):SocialSnapshot|null{
  const o=obj(source),profile=obj(o.profile);
  const posts=arr(o.posts).slice(0,8).map((v,i)=>{
    const p=obj(v),text=txt(p.text,750),visual=txt(p.visual,260);
    if(!text&&!visual)return null;
    const comments=arr(p.comments).slice(0,6).map((v,j)=>{
      const c=obj(v),authorName=txt(c.authorName,50),content=txt(c.content,240);
      if(!authorName||!content)return null;
      return {id:'c'+i+'-'+j,authorName,content,charReply:txt(c.charReply,200)||undefined,knownNpc:npcNames.includes(authorName)};
    }).filter(c=>c!==null) as SocialComment[];
    return {id:'p'+i,text,visual:visual||undefined,topic:txt(p.topic,100)||undefined,likes:limitNum(p.likes),comments};
  }).filter(p=>p!==null) as SocialPost[];
  const viewed=arr(o.viewed).slice(0,9).map((v,i)=>{
    const p=obj(v),authorName=txt(p.authorName,50),text=txt(p.text,450);
    if(!authorName||!text)return null;
    return {id:'v'+i,authorName,text,visual:txt(p.visual,240)||undefined,topic:txt(p.topic,100)||undefined,charComment:txt(p.charComment,250)||undefined};
  }).filter(p=>p!==null) as SocialViewed[];
  if(!posts.length&&!viewed.length)return null;
  return {characterId:charId,appId,profile:{handle:txt(profile.handle,50).replace(/\s/g,'')||'未设置',bio:txt(profile.bio,190)},posts,viewed,generatedAt:now};
}
export function readSocialSnapshot(charId:string,appId:SocialContentApp):SocialSnapshot|null{
  if(!charId||typeof localStorage==='undefined')return null;
  try{
    const v=obj(JSON.parse(localStorage.getItem(storeKey(charId,appId))||'null'));
    if(v.characterId!==charId||v.appId!==appId||!Array.isArray(v.posts)||!Array.isArray(v.viewed)||typeof v.generatedAt!=='number'||!Number.isFinite(v.generatedAt))return null;
    return v as unknown as SocialSnapshot;
  }catch{return null;}
}
export function saveSocialSnapshot(snapshot:SocialSnapshot):SocialSnapshot{
  if(!snapshot.characterId||typeof localStorage==='undefined')throw new Error('无法存储账号内容');
  localStorage.setItem(storeKey(snapshot.characterId,snapshot.appId),JSON.stringify(snapshot));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(SOCIAL_SNAPSHOT_CHANGED,{detail:{characterId:snapshot.characterId,appId:snapshot.appId}}));
  return snapshot;
}
export type SocialGenerationInput={
  char:CharacterProfile;user:UserProfile;groups:GroupProfile[];realtimeConfig?:RealtimeConfig;
  api:{baseUrl:string;apiKey:string;model:string};appId:SocialContentApp;
};
export async function generateSocialSnapshot(input:SocialGenerationInput):Promise<SocialSnapshot>{
  const {char,appId}=input;
  if(!char?.id)throw new Error('缺少角色信息');
  const installed=()=>readCharacterPhoneInstallPlan(char.id)?.installedAppIds.includes(appId)===true;
  if(!installed())throw new Error('这款应用尚未安装');
  const taskId=char.id+':'+appId;
  if(inFlight.has(taskId))return inFlight.get(taskId)!;
  const api=resolveCharacterPhoneApi(char.id,input.api);
  if(!api.baseUrl||!api.apiKey||!api.model)throw new Error('请先配置查手机或聊天 API');
  const task=(async()=>{
    const [context,visible,life]=await Promise.all([
      buildCharacterPhoneContext(char,input.user,input.groups,input.realtimeConfig),
      loadCharacterContextMessages(char),getCharacterLifeScheduleContext(char),
    ]);
    const npc=readNpcProfiles(char.id).slice(0,20);
    const previous=readSocialSnapshot(char.id,appId);
    const previousSummary=previous?JSON.stringify({profile:previous.profile,
      posts:previous.posts.slice(-3).map(p=>p.text),viewed:previous.viewed.slice(-3).map(p=>p.text)}).slice(0,1700):'无';
    const recent=visible.slice(-18).map(m=>(m.role==='user'?'User':'Char')+': '+String(m.content||'').slice(0,270)).join('\n').slice(0,4500);
    const prompt=[
      '你在构造一个虚构角色专属手机的'+(appId==='weibo'?'微博':'Instagram')+'内容快照，绝不连接真实平台。',
      'Char：'+char.name+'。这完全是 Char 的账号。User 不得代替 Char 发帖。人设、世界书、私聊中的身份和习惯优先，禁止 OOC。',
      'Char 可以内敛、寡言、低调。不要强制频繁发帖。言语、用词、图片审美、兴趣和活动必须匹配角色。',
      '只将真实存档中的已发生事件当作事实，日程仅是计划；不要胡编搬家、恋爱、工作或旅行等重大事件。',
      '平台差异：'+(appId==='weibo'?'微博以动态、话题、短文和转评为主。':'Instagram 以照片、个人审美、简短 caption 和故事感为主；visual 仅是画面文字描述，不是图片URL。'),
      '已存在的 NPC（保持人物性格、身份与关系）：'+JSON.stringify(npc.map(n=>({name:n.name,identity:n.identity,personality:n.personality,relationship:n.relationship,speechStyle:n.speechStyle}))).slice(0,3000),
      '优先让上述已有 NPC 互动。允许不认识的普通网友路过发言，但绝对不能擅自说他们是亲友、恋人或老同学。',
      '角色固定核心上下文：'+context.systemPrompt.slice(0,8500),
      '可见私聊：'+recent,
      '当前日程（未发生）：'+(life.plannedActivity||'未知')+' '+(life.plannedDescription||''),
      '确实发生的生活事件：'+JSON.stringify(life.confirmedEvents.slice(0,9).map(e=>e.summary)).slice(0,1600),
      '该平台之前内容（连贯且避免重复）：'+previousSummary,
      '只输出 JSON，且必须有如下字段：',
      '{"profile":{"handle":"角色账号昵称","bio":"角色简介"},"posts":[{"text":"Char 本人发的内容","topic":"可空","visual":"照片/画面的文字描述（可空）","likes":12,"comments":[{"authorName":"NPC名字","content":"NPC评论","charReply":"Char回复（可空）"}]}],"viewed":[{"authorName":"原作者昵称","text":"Char看到的内容","topic":"可空","visual":"画面描述（可空）","charComment":"Char留下的评论（可空）"}]}',
      'posts 2-4 条（如人设不爱发则更少），viewed 3-5 条。内容短而有生活感，评论贴合既有 NPC 的语气。',
      '不要提供真实照片链接、未证实新闻、未经核实的热搜；也不要额外建立第二套独立人设。',
    ].join('\n\n');
    const response=await fetch(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
      method:'POST',signal:AbortSignal.timeout(65_000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
      body:JSON.stringify({model:api.model,stream:false,temperature:0.65,messages:[
        {role:'system',content:prompt},
        {role:'user',content:'请为这个已安装的应用生成 Char 的真实设定一致的使用痕迹，只输出 JSON。'},
      ]}),
    });
    const json=await safeResponseJson(response);
    if(!response.ok)throw new Error(json?.error?.message||'内容生成失败');
    const raw=extractContent(json).trim().replace(/^\x60{3}(?:json)?\s*/i,'').replace(/\s*\x60{3}$/,'');
    let data:unknown;
    try{data=JSON.parse(raw);}
    catch{
      const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
      if(start<0||end<=start)throw new Error('AI 返回格式错误，已保留原内容');
      try{data=JSON.parse(raw.slice(start,end+1));}catch{throw new Error('AI 返回格式错误，已保留原内容');}
    }
    const next=normalizeSocialSnapshot(char.id,appId,data,npc.map(n=>n.name));
    if(!next)throw new Error('AI 没有返回可用内容，已保留原内容');
    if(!installed())throw new Error('生成时应用已卸载，不保存结果');
    return saveSocialSnapshot(next);
  })();
  inFlight.set(taskId,task);
  try{return await task;}finally{if(inFlight.get(taskId)===task)inFlight.delete(taskId);}
}
