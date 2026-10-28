import type { CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import { getLastInnerState } from './emotionState';
import { classifyLifeActivity } from './sullyLifeClock';
import { readCharacterLifeEvents, recordCharacterLifeEvent } from './characterLifeEvents';
import {
  getBaiduSearchUrl, readCharacterPhoneBrowserHistory,
  recordPhoneBrowserNavigation, type PhoneBrowserVisit,
} from './characterPhoneBrowser';
import { extractContent } from './safeApi';
import { fetchCharacterPhoneJson, canRunAutomaticPhoneAi } from './characterPhoneAiRequest';
import { isCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import { readPhoneAutonomyPreferences, canUsePhoneApiBudget, reservePhoneApiBudget, readPhoneAutonomyRevision } from './characterPhoneApiBudget';
import { resolveCharacterPhoneApi } from './characterPhoneApiConfig';

type Api = { baseUrl: string; apiKey: string; model: string };
type Input = {
  char: CharacterProfile;
  user: UserProfile;
  groups: GroupProfile[];
  realtimeConfig?: RealtimeConfig;
  api: Api;
};
export type BrowserAutonomyResult = {
  status: 'skipped' | 'generated' | 'failed';
  count: number;
  reason?: string;
};
const locks = new Set<string>();
const STATE_KEY = (id:string) => 'sully_char_browser_autonomy_v1:' + id;
type State = { day:string; attempts:number; generated:number; lastAttemptAt:number };
function readState(id:string, now:number):State {
  const day = new Date(now).toLocaleDateString('en-CA');
  try {
    const row = JSON.parse(localStorage.getItem(STATE_KEY(id)) || '{}');
    return {
      day, attempts: row.day===day && Number.isFinite(row.attempts)?row.attempts:0,
      generated: row.day===day && Number.isFinite(row.generated)?row.generated:0,
      lastAttemptAt: Number.isFinite(row.lastAttemptAt)?row.lastAttemptAt:0,
    };
  } catch {return {day,attempts:0,generated:0,lastAttemptAt:0};}
}
function store(id:string, state:State):void {
  localStorage.setItem(STATE_KEY(id),JSON.stringify(state));
}
const text = (value:unknown, length:number):string =>
  typeof value==='string' ? value.trim().replace(/\s+/g,' ').slice(0,length) : '';

/** Simulate autonomous Char decisions to search with a *real Baidu URL*.
 * Browsing query/motive are generated; results or page contents are NOT
 * fabricated and no claim is made that the AI actually fetched Baidu HTML.
 * Integrates in the same OS foreground tick, never opens external tabs itself.
 */
export async function runCharacterPhoneBrowserAutonomy(
  input:Input,
  mode:'background'|'manual'='background',
):Promise<BrowserAutonomyResult> {
  const {char,user,groups,realtimeConfig}=input;
  const api=char?.id?resolveCharacterPhoneApi(char.id,input.api):input.api;
  if (!char?.id || !api?.baseUrl || !api?.apiKey || !api?.model ||
      typeof localStorage==='undefined') return {status:'skipped',count:0,reason:'API 未配置'};
  if (mode==='background' && (typeof document==='undefined' ||
      document.visibilityState!=='visible' || !isCharacterPhoneAutonomyEnabled(char.id) ||
      !readPhoneAutonomyPreferences(char.id).browserAutoEnabled || !canUsePhoneApiBudget(char.id)))
    return {status:'skipped',count:0};
  if (mode === 'background' && !canRunAutomaticPhoneAi(char.id, api.baseUrl.replace(/\/+$/, '') + '/chat/completions'))
    return {status:'skipped',count:0,reason:'上游暂时不可用，后台已暂停'};
  if (locks.has(char.id)) return {status:'skipped',count:0,reason:'正在生成'};
  locks.add(char.id);
  const startRevision=readPhoneAutonomyRevision(char.id);
  const stillAllowed=()=>mode!=='background'||(
    isCharacterPhoneAutonomyEnabled(char.id) &&
    readPhoneAutonomyPreferences(char.id).backgroundApiEnabled &&
    readPhoneAutonomyPreferences(char.id).browserAutoEnabled &&
    readPhoneAutonomyRevision(char.id)===startRevision
  );
  const now=Date.now();
  try {
    const state=readState(char.id,now);
    if (state.generated >= (mode==='background'?2:4) || state.attempts >= (mode==='background'?3:6) ||
        now-state.lastAttemptAt < (mode==='background'?12*3600_000:90_000))
      return {status:'skipped',count:0,reason:'搜索冷却中或达到今日上限'};
    const life=await getCharacterLifeScheduleContext(char,new Date(now));
    const lifeStatus=classifyLifeActivity(char.scheduleFeatureEnabled===false?'':(life.plannedActivity||''));
    if (mode==='background' && (lifeStatus==='sleep' || lifeStatus==='busy'))
      return {status:'skipped',count:0,reason:'角色现在不方便浏览'};
    const existing=readCharacterPhoneBrowserHistory(char.id);
    const recent = existing.filter(e=>e.actor==='char').slice(0,10)
      .map(e=>({query:e.query,reason:e.aiJudgement,time:e.visitedAt}));
    const confirmed=readCharacterLifeEvents(char.id).filter(e=>e.occurredAt<=now)
      .slice(0,12).map(e=>({id:e.id,summary:e.summary.slice(0,165)}));
    const innerState=getLastInnerState(char.id).slice(0,1100);
    const context=await buildCharacterPhoneContext(char,user,groups,realtimeConfig);
    // Reserve network budget before request: a failing provider must not run
    // forever in the background or be triggered by every page remount.
    if (!stillAllowed())return {status:'skipped',count:0,reason:'后台浏览权限已变化'};
    if (mode==='background' && !reservePhoneApiBudget(char.id))
      return {status:'skipped',count:0,reason:'自主调用预算已用完'};
    state.lastAttemptAt=now;state.attempts++;
    store(char.id,state);
    const { response, json } = await fetchCharacterPhoneJson(api.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+api.apiKey},
      body:JSON.stringify({model:api.model,stream:false,temperature:0.75,messages:[
        {role:'system',content:`这是虚构角色 ${char.name} 自己的手机浏览器，你只决定 TA 会查什么，不是 User 在搜索。
一切行为以 Char 自身的人设、生活任务、偏好与心境为理由；不围绕 User 机械转动。
原设、世界书、真实私聊上下文：${context.systemPrompt.slice(0,9500)}
当前日程（只是计划，不代表已发生）：${life.plannedActivity||'无'}；${life.plannedDescription||''}
最近一次角色内心状态（可能不是最新）：${innerState||'无'}
已保存生活经历：${JSON.stringify(confirmed).slice(0,2000)}
已有浏览记录，避免重复：${JSON.stringify(recent).slice(0,1200)}
若角色没理由使用手机，可以返回 search:false。否则输出1至2条具体百度搜索词。
每条必须包含 title（简短主题）、query（具体搜索短语，不要只有「电影/音乐/吃饭」等大词）、reason（Char 当时为什么要查、心里在想什么）、note（TA 准备找哪类信息，而非已经看到的网页结论）、mood（当时心情），以及sourceEventIds（最多2个确切对应的已保存生活事件ID；可空）。
搜索行为可受到现实情绪影响，也可以由自己的工作、爱好、好奇、与NPC的未了话题触发。
禁止编造实际百度结果、网页文章标题、权威结论、已完成的线下行动或用户搜索记录；不可输出网页正文。只输出JSON：
{"search":true,"records":[{"title":"具体主题","query":"具体可搜索词","reason":"我为什么要查","note":"我想弄清什么","mood":"心情","sourceEventIds":[]}]}。
内容务必符合真实角色自己的身份，不要为了填记录强行搜索。`},
        {role:'user',content:'由角色独立决定是否打开百度搜索，留下搜索动机和想法；没有自然动机就不搜索。'},
      ]}),
    }, { charId: char.id, purpose: '浏览器自主搜索动机', automatic: mode === 'background' });
    if(!response.ok) throw new Error(json?.error?.message||'浏览器 AI 请求失败');
    const raw=extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    const data=JSON.parse(raw);
    if(data?.search!==true || !Array.isArray(data.records)) return {status:'skipped',count:0};
    // The user may have disabled background phone AI while this LLM was
    // in flight. Do not persist fabricated "already browsed" records.
    if (!stillAllowed())return {status:'skipped',count:0,reason:'后台浏览权限已变化'};
    const allowId=new Set(confirmed.map(e=>e.id));
    const saved:PhoneBrowserVisit[]=[];
    for(const item of data.records.slice(0,2)) {
      if(state.generated + saved.length>=4) break;
      const query=text(item?.query,100);
      const reason=text(item?.reason,300);
      const title=text(item?.title,100);
      const note=text(item?.note,400);
      if(query.length<4 || reason.length<4 || !title) continue;
      const url=getBaiduSearchUrl(query);
      if(!url) continue;
      const entry=recordPhoneBrowserNavigation(char.id,{
        kind:'baidu-search', query,url,
      },'char',{
        origin:'ai-generated',title,aiJudgement:reason,summary:note,
        mood:text(item.mood,90),plannedActivity:life.plannedActivity||undefined,
        sourceEventIds:Array.isArray(item.sourceEventIds)
          ?item.sourceEventIds.filter((v:unknown):v is string=>typeof v==='string'&&allowId.has(v)).slice(0,2):[],
      });
      if(entry) saved.push(entry);
    }
    if(saved.length) {
      const latest=readState(char.id,Date.now());
      latest.generated+=saved.length;
      store(char.id,latest);
      for(const entry of saved) {
        recordCharacterLifeEvent({
          id:'browser-search:'+entry.id,characterId:char.id,kind:'browser-search',
          source:'phone',occurredAt:entry.visitedAt,
          summary:char.name+'在自己的手机里搜索了「'+entry.query+'」；原因：'+(entry.aiJudgement||'想查资料').slice(0,260)+
            '。这是搜索记录，不代表已经阅读或验证百度结果。',
        });
      }
    }
    return {status:saved.length?'generated':'skipped',count:saved.length};
  } catch(error) {
    console.warn('[CharacterPhoneBrowser] AI autonomous browsing skipped',error);
    return {status:'failed',count:0,reason:error instanceof Error?error.message:'浏览器生成失败'};
  } finally {locks.delete(char.id);}
}
