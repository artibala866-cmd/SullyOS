import { readCharacterMoments, publishCharacterMoment } from './characterPhoneMoments';
import { readCharacterPhoneChats } from './characterPhoneChats';
import { isCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import type { NpcProfile } from './characterPhoneNpcs';
import { safeResponseJson, extractContent } from './safeApi';

type Api = { baseUrl:string; apiKey:string; model:string };
export async function refreshNpcMoments(characterId:string, contacts:NpcProfile[], api:Api):Promise<number> {
  if (!api.baseUrl || !api.apiKey || !api.model) throw new Error('请先配置聊天 API');
  const candidates=contacts.filter(p=>p.id!==characterId && p.name && p.personality);
  if (!candidates.length) throw new Error('请先添加有性格档案的 NPC 联系人');
  const key='sully_npc_moments_refresh_v1:'+characterId;
  const last=Number(localStorage.getItem(key)||0);
  if (Date.now()-last<10*60*1000) return 0;
  const chosen=[...candidates].sort(()=>Math.random()-0.5).slice(0,6);
  const recent=readCharacterMoments(characterId).filter(p=>!p.deletedAt).slice(0,24);
  const chats=readCharacterPhoneChats(characterId).filter(r=>chosen.some(p=>p.id===r.contactId))
    .map(r=>({contactId:r.contactId,recent:r.messages.slice(-5).map(m=>({
      speaker:m.speaker.role,text:m.text.slice(0,180)
    }))})).slice(0,6);
  const response=await fetch(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
    body:JSON.stringify({model:api.model,stream:false,messages:[
      {role:'system',content:'你模拟微信朋友圈中NPC各自的独立日常。只能让给定联系人发帖，绝对不能生成Char或User的帖子。根据每个人的性格、身份和生活圈决定是否发；可以无人发帖。内容自然、不同风格，不围绕Char或User，不冒充真实聊天事件，不重复近期内容。只返回JSON：{"posts":[{"authorId":"给定联系人ID","text":"朋友圈正文"}]}。最多4条。联系人：'+JSON.stringify(chosen.map(p=>({id:p.id,name:p.name,identity:p.identity,personality:p.personality,background:p.background}))).slice(0,6500)+'。与手机主人已保存的最近微信：'+JSON.stringify(chats).slice(0,2500)+'。近期动态：'+JSON.stringify(recent.map(p=>({authorId:p.authorId,text:p.text}))).slice(0,4000)},
      {role:'user',content:'看看这些NPC好友最近是否有新的朋友圈。'}
    ]})
  });
  const json=await safeResponseJson(response);
  if(!response.ok)throw new Error(json?.error?.message||'HTTP '+response.status);
  const raw=extractContent(json).trim();
  const data=JSON.parse(raw.startsWith('```')?raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''):raw);
  if(!Array.isArray(data.posts))throw new Error('NPC 朋友圈格式错误');
  let count=0;
  for(const item of data.posts.slice(0,4)){
    if(!chosen.some(p=>p.id===item?.authorId)||typeof item.text!=='string'||!item.text.trim())continue;
    const text=item.text.trim().slice(0,1200);
    if(readCharacterMoments(characterId).some(p=>p.authorId===item.authorId&&p.text===text))continue;
    if(publishCharacterMoment({characterId,authorId:item.authorId,origin:'npc',text,imageUrls:[],visibility:'all'}))count++;
  }
  localStorage.setItem(key,String(Date.now()));
  return count;
}


/** At most two independent NPC life-feed refreshes per character per day.
 * Uses the SAME phone OS tick, not another timer or AMSG task.
 */
export async function considerAutonomousNpcMoments(
  characterId: string, api: Api,
): Promise<number> {
  if (!isCharacterPhoneAutonomyEnabled(characterId)) return 0;
  const contacts = (await import('./characterPhoneNpcs')).readNpcProfiles(characterId);
  if (!contacts.length) return 0;
  const key = 'sully_npc_moments_autonomy_v1:' + characterId;
  const now = Date.now();
  const day = new Date(now).toLocaleDateString('en-CA');
  let previous: { day?: string; attempts?: number; at?: number } = {};
  try { previous = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  const attempts = previous.day === day ? Number(previous.attempts || 0) : 0;
  if (attempts >= 2 || now - Number(previous.at || 0) < 5 * 3600000) return 0;
  // Reserve the attempt before the API call, including when no NPC wants to post.
  try { localStorage.setItem(key, JSON.stringify({ day, attempts: attempts + 1, at: now })); }
  catch { return 0; }
  try { return await refreshNpcMoments(characterId, contacts, api); }
  catch (error) {
    console.warn('[NpcMoments] auto refresh failed', error);
    return 0;
  }
}
