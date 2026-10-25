/**
 * Character-owned optional social app installation plan.
 * Modelled after momo.float.phone's fixed-app / optional-app manifest, but
 * deliberately limited to four new shell-only apps in this phase.
 * Basic phone apps remain visible even without a provider.
 */
import type { CharacterProfile, UserProfile, GroupProfile, RealtimeConfig } from '../types';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { safeResponseJson, extractContent } from './safeApi';
import { resolveCharacterPhoneApi } from './characterPhoneApiConfig';

export const CHARACTER_PHONE_SOCIAL_APPS = ['x','bilibili','weibo','instagram'] as const;
export type CharacterPhoneSocialAppId = typeof CHARACTER_PHONE_SOCIAL_APPS[number];
export const CHARACTER_PHONE_INSTALL_CHANGED = 'sully:character-phone-install-changed';
export const CHARACTER_PHONE_SOCIAL_APP_INFO: Record<CharacterPhoneSocialAppId,{label:string;subtitle:string}> = {
  x:{label:'X',subtitle:'观点与即时讨论'},
  bilibili:{label:'B站',subtitle:'视频、兴趣和创作'},
  weibo:{label:'微博',subtitle:'话题、动态与热搜'},
  instagram:{label:'Instagram',subtitle:'照片、视觉生活与创作'},
};
export type CharacterPhoneInstallPlan = {
  characterId:string;
  installedAppIds:CharacterPhoneSocialAppId[];
  reason:string;
  generatedAt:number;
  source:'ai' | 'manual';
};
const PREFIX='sully_character_phone_install_plan_v1:';
const inFlight=new Set<string>();
export function isCharacterPhoneSocialAppId(id:unknown):id is CharacterPhoneSocialAppId {
  return typeof id==='string' && (CHARACTER_PHONE_SOCIAL_APPS as readonly string[]).includes(id);
}
function uniqueIds(raw:unknown):CharacterPhoneSocialAppId[] {
  return Array.isArray(raw)?[...new Set(raw.filter(isCharacterPhoneSocialAppId))]:[];
}
export function readCharacterPhoneInstallPlan(characterId:string):CharacterPhoneInstallPlan|null {
  if(!characterId || typeof localStorage==='undefined')return null;
  try {
    const raw=JSON.parse(localStorage.getItem(PREFIX+characterId)||'null');
    if(raw?.characterId!==characterId || !Array.isArray(raw?.installedAppIds))return null;
    return {
      characterId,installedAppIds:uniqueIds(raw.installedAppIds),
      reason:typeof raw.reason==='string'?raw.reason.slice(0,220):'',
      generatedAt:Number.isFinite(raw.generatedAt)?raw.generatedAt:0,
      source:raw.source==='manual'?'manual':'ai',
    };
  }catch{return null;}
}
export function saveCharacterPhoneInstallPlan(plan:CharacterPhoneInstallPlan):CharacterPhoneInstallPlan {
  if(!plan.characterId || typeof localStorage==='undefined')throw new Error('Missing phone owner');
  const sanitized:CharacterPhoneInstallPlan={
    ...plan,installedAppIds:uniqueIds(plan.installedAppIds),
    reason:plan.reason.slice(0,220),
  };
  localStorage.setItem(PREFIX+plan.characterId,JSON.stringify(sanitized));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_INSTALL_CHANGED,{
    detail:{characterId:plan.characterId},
  }));
  return sanitized;
}
export function setCharacterPhoneSocialAppInstalled(
  characterId:string,appId:CharacterPhoneSocialAppId,installed:boolean,
):CharacterPhoneInstallPlan {
  const old=readCharacterPhoneInstallPlan(characterId);
  const current=old?.installedAppIds||[];
  const next=installed?[...current,appId]:current.filter(id=>id!==appId);
  return saveCharacterPhoneInstallPlan({
    characterId,installedAppIds:uniqueIds(next),
    reason:old?.reason||'由 Char 自己管理的应用安装清单。',
    generatedAt:old?.generatedAt||Date.now(),source:'manual',
  });
}
export type CharacterPhoneInstallInput = {
  char:CharacterProfile;user:UserProfile;groups:GroupProfile[];
  realtimeConfig?:RealtimeConfig;
  api:{baseUrl:string;apiKey:string;model:string};
};
export async function generateCharacterPhoneInstallPlan(
  input:CharacterPhoneInstallInput,force=false,
):Promise<CharacterPhoneInstallPlan> {
  const char=input.char;
  if(!char?.id)throw new Error('尚未选择手机主人');
  const existing=readCharacterPhoneInstallPlan(char.id);
  if(existing&&!force)return existing;
  if(inFlight.has(char.id))throw new Error('正在分析这个角色的安装偏好');
  const api=resolveCharacterPhoneApi(char.id,input.api);
  if(!api.baseUrl||!api.apiKey||!api.model)throw new Error('请先配置聊天 API 或查手机独立 API');
  inFlight.add(char.id);
  try {
    const context=await buildCharacterPhoneContext(char,input.user,input.groups,input.realtimeConfig);
    // Use canonical private-chat context. Do not invent preferences based on
    // names alone or store another AI personality. One request, no retry loop.
    const response=await fetch(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
      method:'POST',signal:AbortSignal.timeout(60_000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
      body:JSON.stringify({model:api.model,stream:false,temperature:0.4,messages:[
        {role:'system',content:`你正在为虚构角色「${char.name}」配置角色自己的手机桌面，不是替 User 选软件。
微信、备忘录、相册、电话、短信、浏览器、钱包与设置是固定基础软件，永远保留，不需要生成。
本次只能从四个候选软件里选择适合角色真实长期喜好、文化习惯、职业兴趣的软件：
x（X/Twitter：文字观点、国际讨论）；bilibili（B站：视频、兴趣圈、二创）；weibo（微博：中文话题、动态、热搜）；instagram（Instagram：照片、创作、视觉社交）。
依据角色的稳定人设、世界书、已有私聊及生活习惯，选择1-4个合理 App；不用机械全选，也不要因为User喜欢就替角色安装。
原设与真实私聊上下文：${context.systemPrompt.slice(0,8000)}
近期聊天摘要片段：${context.privateMessages.slice(-8).map(m=>String(m.content||'').slice(0,180)).join(' / ').slice(0,1500)}
返回严格 JSON：{"installedAppIds":["bilibili","x"],"reason":"一句话解释安装倾向"}。
数组只允许 x、bilibili、weibo、instagram，无重复；不生成帖子、账号或任何平台内容。`},
        {role:'user',content:'请根据这位 Char 自己的性格与生活偏好决定首次手机安装清单。'},
      ]}),
    });
    const json=await safeResponseJson(response);
    if(!response.ok)throw new Error(json?.error?.message||'安装分析 API 请求失败');
    const raw=extractContent(json).trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
    let parsed:unknown;
    try {parsed=JSON.parse(raw);}catch{throw new Error('安装分析返回格式不正确，可在设置中重新分析');}
    const data=parsed as {installedAppIds?:unknown;reason?:unknown};
    const installedAppIds=uniqueIds(data?.installedAppIds);
    if(installedAppIds.length<1)throw new Error('未得到有效安装建议，未改变原有手机');
    const plan:CharacterPhoneInstallPlan={
      characterId:char.id,installedAppIds,
      reason:typeof data.reason==='string'?data.reason.trim().slice(0,220):'按角色生活偏好选择',
      generatedAt:Date.now(),source:'ai',
    };
    // A user might manually install apps while this slow request is running.
    // Never overwrite that newer decision.
    if(!force){
      const latest=readCharacterPhoneInstallPlan(char.id);
      if(latest)return latest;
    }
    return saveCharacterPhoneInstallPlan(plan);
  }finally{inFlight.delete(char.id);}
}
