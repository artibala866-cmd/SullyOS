import type { CharacterProfile } from '../types';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import {
  activateCharacterAvatar, readCharacterAvatarLibrary,
} from './characterAvatarLibrary';
import { extractContent, safeResponseJson } from './safeApi';
import { readPhoneAutonomyPreferences, canUsePhoneApiBudget, reservePhoneApiBudget } from './characterPhoneApiBudget';
import { resolveCharacterPhoneApi } from './characterPhoneApiConfig';

export type PhoneSelfProfile = {
  characterId:string;
  pokeSuffix:string;
  mood:string;
  reason:string;
  updatedAt:number;
};
export const CHARACTER_PHONE_SELF_CHANGED='sully:character-phone-self-changed';
const storageKey=(id:string)=>'sully_character_phone_self_v1:'+id;
const lock=new Set<string>();
const cooldownKey=(id:string)=>'sully_character_phone_self_auto_at:'+id;
type Api={baseUrl:string;apiKey:string;model:string};
export function readCharacterPhoneSelfProfile(characterId:string):PhoneSelfProfile {
  try {
    const raw=JSON.parse(localStorage.getItem(storageKey(characterId))||'null');
    return {
      characterId,
      pokeSuffix:typeof raw?.pokeSuffix==='string'?raw.pokeSuffix.slice(0,65):'',
      mood:typeof raw?.mood==='string'?raw.mood.slice(0,90):'',
      reason:typeof raw?.reason==='string'?raw.reason.slice(0,220):'',
      updatedAt:Number.isFinite(raw?.updatedAt)?raw.updatedAt:0,
    };
  } catch {return {characterId,pokeSuffix:'',mood:'',reason:'',updatedAt:0};}
}
export function saveCharacterPhoneSelfProfile(profile:PhoneSelfProfile):boolean {
  if(!profile.characterId || !profile.pokeSuffix.trim())return false;
  try {
    localStorage.setItem(storageKey(profile.characterId),JSON.stringify(profile));
    if(typeof window!=='undefined')
      window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_SELF_CHANGED,{detail:{characterId:profile.characterId}}));
    return true;
  } catch {return false;}
}

/** Reuses Char's existing avatar library without a second mood system.
 * Chooses only vision-described IDs. Updates the canonical
 * CharacterProfile.avatar through caller's existing updateCharacter pipeline.
 */
export async function runCharacterPhoneSelfAutonomy(
  char:CharacterProfile, inputApi:Api,
  applyAvatar?: (image:string)=>Promise<void>,
  force=false,
):Promise<'changed'|'skipped'|'failed'> {
  const api=resolveCharacterPhoneApi(char.id,inputApi);
  if(!char.id || !api.baseUrl || !api.apiKey || !api.model || typeof localStorage==='undefined')
    return 'skipped';
  if(lock.has(char.id))return 'skipped';
  if(!force && (!readPhoneAutonomyPreferences(char.id).selfProfileAutoEnabled || !canUsePhoneApiBudget(char.id)))return 'skipped';
  const now=Date.now();
  try {
    if(!force && now-Number(localStorage.getItem(cooldownKey(char.id))||'0')<24*3600_000)
      return 'skipped';
  } catch {return 'skipped';}
  lock.add(char.id);
  try {
    const lib=readCharacterAvatarLibrary(char.id);
    const candidates=lib.autonomousEnabled
      ?lib.entries.filter(e=>!!e.visionDescription).slice(0,14):[];
    const old=readCharacterPhoneSelfProfile(char.id);
    const life=await getCharacterLifeScheduleContext(char,new Date(now));
    if(!force && /睡觉|入睡|就寝|休息/.test(life.plannedActivity||''))
      return 'skipped';
    // Update a single social profile + image together without extra API calls.
    if(!force && !reservePhoneApiBudget(char.id))return 'skipped';
    localStorage.setItem(cooldownKey(char.id),String(now));
    const response=await fetch(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
      method:'POST',signal:AbortSignal.timeout(60_000),
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
      body:JSON.stringify({model:api.model,stream:false,temperature:0.7,messages:[
        {role:'system',content:`你为角色 ${char.name} 自己的微信“我”的个人资料作自然调整。
你不能改变角色设定或扮演 User。当前角色人设：${[char.systemPrompt,char.description,char.worldview].filter(Boolean).join('\n').slice(0,4500)}
当前角色日程（只是计划）：${life.plannedActivity||'无'}；${life.plannedDescription||''}。
当前戳一戳后缀：${old.pokeSuffix||'未设置'}。
头像库识图结果（只有这些 ID 可以用，其他图片一律不存在）：${JSON.stringify(candidates.map(e=>({id:e.id,description:e.visionDescription?.slice(0,300)}))).slice(0,4500)}
可依据角色固定人设、个人审美和已识图的照片描述决定是否更换头像；不要根据临时情绪选图，不必每次换。
戳一戳“后缀”是别人戳了戳角色后显示的文字，如“的书包里藏着糖”“的肩膀”。
必须是符合角色设定和日常习惯的 2 至 20 个汉字/符号，不可以包含真实隐私或 URL。
不要因为日程写了某事就认为某事已经完成。
只输出JSON：{"pokeSuffix":"的肩膀","reason":"为什么想这样设置资料","avatarId":"可选的候选头像ID或空字符串"}。
如果没有值得换的头像，avatarId为空；严禁选未经识图的图片。`},
        {role:'user',content:'由 Char 自己决定资料状态和戳一戳后缀，头像只能从实际识图过的收藏里挑选。'},
      ]}),
    });
    const json=await safeResponseJson(response);
    if(!response.ok)throw new Error(json?.error?.message||'头像偏好 AI 请求失败');
    const raw=extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const data=JSON.parse(raw);
    let suffix=typeof data?.pokeSuffix==='string'?data.pokeSuffix.trim().replace(/[<>\r\n]/g,'').slice(0,48):'';
    if(!suffix) suffix=old.pokeSuffix;
    const reason=typeof data?.reason==='string'?data.reason.trim().slice(0,220):'';
    let changed=false;
    if(suffix && suffix!==old.pokeSuffix) {
      changed=saveCharacterPhoneSelfProfile({
        characterId:char.id,pokeSuffix:suffix,mood:old.mood,reason,updatedAt:Date.now(),
      });
    }
    const choice=typeof data?.avatarId==='string'?data.avatarId:'';
    const image=choice && choice!==lib.activeId ? candidates.find(e=>e.id===choice)?.image : undefined;
    if(image && applyAvatar) {
      // CharacterProfile first; if persistence fails do not broadcast a new
      // library selection that would diverge from the canonical profile.
      await applyAvatar(image);
      if(activateCharacterAvatar(char.id,choice,true))changed=true;
    }
    return changed?'changed':'skipped';
  }catch(error){
    console.warn('[CharacterPhone] self profile autonomy failed',error);
    return 'failed';
  }finally{lock.delete(char.id);}
}
