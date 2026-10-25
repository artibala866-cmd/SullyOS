import { readCharacterMoments, publishCharacterMoment, addMomentComment } from './characterPhoneMoments';
import { readMomentInteractionPreferences, allowMomentComment } from './momentInteractionPreferences';
import { fetchCharacterPhoneJson, canRunAutomaticPhoneAi } from './characterPhoneAiRequest';
import { readCharacterPhoneChats } from './characterPhoneChats';
import { isCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import { canUsePhoneApiBudget, reservePhoneApiBudget } from './characterPhoneApiBudget';
import { beginCharacterPhoneRefresh, finishCharacterPhoneRefresh } from './characterPhoneRefreshTracker';
import type { NpcProfile } from './characterPhoneNpcs';
import { extractContent } from './safeApi';

type Api = { baseUrl:string; apiKey:string; model:string };
export async function refreshNpcMoments(characterId:string, contacts:NpcProfile[], api:Api, automatic=false):Promise<number> {
  if (!api.baseUrl || !api.apiKey || !api.model) throw new Error('请先配置聊天 API');
  const candidates=contacts.filter(p=>p.id!==characterId && p.name && p.personality);
  if (!candidates.length) throw new Error('请先添加有性格档案的 NPC 联系人');
  const key='sully_npc_moments_refresh_v1:'+characterId;
  const last=Number(localStorage.getItem(key)||0);
  if (Date.now()-last<10*60*1000) return 0;
  if (!beginCharacterPhoneRefresh(characterId, 'moments')) return 0;
  try {
  const chosen=[...candidates].sort(()=>Math.random()-0.5).slice(0,6);
  const recent=readCharacterMoments(characterId).filter(p=>!p.deletedAt).slice(0,24);
  const chats=readCharacterPhoneChats(characterId).filter(r=>chosen.some(p=>p.id===r.contactId))
    .map(r=>({contactId:r.contactId,recent:r.messages.slice(-5).map(m=>({
      speaker:m.speaker.role,text:m.text.slice(0,180)
    }))})).slice(0,6);
  const {response,json}=await fetchCharacterPhoneJson(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
    body:JSON.stringify({model:api.model,stream:false,messages:[
      {role:'system',content:'你模拟微信朋友圈中NPC各自的独立日常。只能让给定联系人发帖，绝对不能生成Char或User的帖子。根据每个人的性格、身份和生活圈决定是否发；可以无人发帖。内容自然、不同风格，不围绕Char或User，不冒充真实聊天事件，不重复近期内容。只返回JSON：{"posts":[{"authorId":"给定联系人ID","text":"朋友圈正文","comments":[{"authorId":"与作者认识的CharID或NPC联系人ID","text":"自然评论","replyToIndex":-1}]}]}。最多4条动态，每条最多3条评论，允许0条。replyToIndex=-1表示直接评论；0或1表示只回复本条动态已生成的某条之前的评论。允许动态作者礼貌回复别人，但禁止回复的回复和接龙。陌生NPC不能假装认识，不能所有人机械表扬，更不能同人重复同句话。熟人关系必须双方mutualContactIds都承认；Char是所有联系人认识的手机主人。其他已存联系人及彼此互认关系：' +JSON.stringify(contacts.slice(0,18).map(p=>({id:p.id,name:p.name,mutualContactIds:p.mutualContactIds,personality:p.personality,speechStyle:p.speechStyle}))).slice(0,4200)+'。发布作者候选：'+JSON.stringify(chosen.map(p=>({id:p.id,name:p.name,identity:p.identity,personality:p.personality,background:p.background}))).slice(0,6500)+'。与手机主人已保存的最近微信：'+JSON.stringify(chats).slice(0,2500)+'。近期动态：'+JSON.stringify(recent.map(p=>({authorId:p.authorId,text:p.text}))).slice(0,4000)},
      {role:'user',content:'看看这些NPC好友最近是否有新的朋友圈。'}
    ]})
  },{charId:characterId,purpose:'NPC 朋友圈新动态与熟人评论',automatic});
  if(!response.ok)throw new Error(json?.error?.message||'HTTP '+response.status);
  const raw=extractContent(json).trim();
  const data=JSON.parse(raw.startsWith('```')?raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''):raw);
  if(!Array.isArray(data.posts))throw new Error('NPC 朋友圈格式错误');
  let count=0;
  for(const item of data.posts.slice(0,4)){
    if(!chosen.some(p=>p.id===item?.authorId)||typeof item.text!=='string'||!item.text.trim())continue;
    const text=item.text.trim().slice(0,1200);
    if(readCharacterMoments(characterId).some(p=>p.authorId===item.authorId&&p.text===text))continue;
    const post=publishCharacterMoment({characterId,authorId:item.authorId,origin:'npc',text,imageUrls:[],visibility:'all'});
    if(!post)continue;
    count++;
    // A new post and its social responses came from the SAME API completion.
    // Check reciprocal NPC relationships and only reply to already saved
    // top-level comments; never manufacture a User response.
    const author=contacts.find(c=>c.id===item.authorId)!;
    const liveIds:string[]=[];
    for(const entry of (Array.isArray(item.comments)?item.comments:[]).slice(0,3)){
      if(typeof entry?.authorId!=='string'||typeof entry?.text!=='string')continue;
      const actorId=entry.authorId,body=entry.text.trim().slice(0,220);
      if(!body||actorId==='user')continue;
      const actor=contacts.find(c=>c.id===actorId);
      if(actorId!==characterId&&(!actor||actorId===author.id&&liveIds.length===0))continue;
      if(actorId!==characterId&&actorId!==author.id&&
        (!author.mutualContactIds?.includes(actorId)||!actor?.mutualContactIds?.includes(author.id)))continue;
      const replyIndex=Number.isInteger(entry.replyToIndex)?entry.replyToIndex:-1;
      const replyToId=replyIndex>=0?liveIds[replyIndex]:undefined;
      if(replyIndex>=0&&!replyToId)continue;
      if(actorId===author.id&&!replyToId)continue;
      const live=readCharacterMoments(characterId).find(p=>p.id===post.id);
      if(!allowMomentComment(live?.comments||[],actorId,body,replyToId))continue;
      const commentId=crypto.randomUUID();
      if(addMomentComment(characterId,post.id,{id:commentId,authorId:actorId,text:body,createdAt:Date.now(),...(replyToId?{replyToId}:{})})){
        liveIds.push(commentId);
      }
    }
  }
  localStorage.setItem(key,String(Date.now()));
  return count;
  } finally {
    finishCharacterPhoneRefresh(characterId, 'moments');
  }
}


/** At most two independent NPC life-feed refreshes per character per day.
 * Uses the SAME phone OS tick, not another timer or AMSG task.
 */
export async function considerAutonomousNpcMoments(
  characterId: string, api: Api,
): Promise<number> {
  const prefs=readMomentInteractionPreferences(characterId);
  if (!prefs.npcPostingEnabled || !isCharacterPhoneAutonomyEnabled(characterId) ||
      !canUsePhoneApiBudget(characterId) ||
      !canRunAutomaticPhoneAi(characterId,api.baseUrl.replace(/\/+$/,'')+'/chat/completions')) return 0;
  const contacts = (await import('./characterPhoneNpcs')).readNpcProfiles(characterId);
  if (!contacts.length) return 0;
  const key = 'sully_npc_moments_autonomy_v1:' + characterId;
  const now = Date.now();
  const day = new Date(now).toLocaleDateString('en-CA');
  let previous: { day?: string; attempts?: number; at?: number } = {};
  try { previous = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  const attempts = previous.day === day ? Number(previous.attempts || 0) : 0;
  const maxPerDay=prefs.pace==='quiet'?1:prefs.pace==='lively'?3:2;
  if (attempts >= maxPerDay || now - Number(previous.at || 0) < prefs.npcPostIntervalMinutes*60_000) return 0;
  // Spend the shared quota only for an actually eligible NPC refresh.
  if (!reservePhoneApiBudget(characterId)) return 0;
  try { localStorage.setItem(key, JSON.stringify({ day, attempts: attempts + 1, at: now })); }
  catch { return 0; }
  try { return await refreshNpcMoments(characterId, contacts, api, true); }
  catch (error) {
    console.warn('[NpcMoments] auto refresh failed', error);
    return 0;
  }
}
