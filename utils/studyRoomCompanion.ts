/** One local, no-cost companion overview shared by every study-room section.
 * Nothing here invokes AI or reads the private ChatApp. User must open,
 * preview and explicitly SEND this bounded context to the selected Char.
 */
import type {WorkspaceData} from './sullyWorkspace';
import {localDate} from './sullyWorkspace';
import {nextDrawableCommissions,nextHomework} from './studyQuickActions';
export type CompanionSession = {mode:'focus'|'break';pauseRemainingMs?:number}|null;
export const companionMomentText=(
 session:CompanionSession,taskName:string,lastDoneMinutes:number,
):string=>{
 if(session?.pauseRemainingMs!=null)return '专注已暂停。'+(taskName?'正在做：'+taskName+'。':'')+'恢复后继续，记录不会丢。';
 if(session?.mode==='focus')return '正在陪你专注'+(taskName?' · '+taskName:'')+'。不打断你。';
 if(session?.mode==='break')return '休息时间。可以喝水、活动一下。';
 if(lastDoneMinutes>0)return '最近一轮已完成 '+lastDoneMinutes+' 分钟。需要时可以一起复盘。';
 return '已经在学习室陪着你。想安排今天的事，可以告诉我。';
};
const text=(value:unknown,max:number)=>
 typeof value==='string'?value.replace(/\s+/g,' ').slice(0,max):'';
export function buildCompanionOverview(
 data:WorkspaceData,session:CompanionSession,taskName:string,now=new Date(),
):string{
 const active=nextDrawableCommissions(data.commissions,5).map(c=>({
   title:text(c.title,96),stage:text(c.stage,32),dueDate:text(c.dueDate,24),
   remainingMinutes:c.remainingMinutes,plannedDate:text(c.plannedDate,24),
 }));
 const homework=nextHomework(data.homework,5).map(h=>({
   title:text(h.title,96),dueAt:text(h.dueAt,32),remainingMinutes:h.minutes,
   course:text(data.classes.find(c=>c.id===h.classId)?.name||'未归属',64),
 }));
 const remaining=data.commissions.filter(c=>c.status==='waiting').length;
 const phase=session?.pauseRemainingMs!=null?'paused':session?.mode||'idle';
 return [
  '这是我在学习室主动选中的 Char。请按我的真实学习/画稿进度和角色性格自然地陪我讨论下一步。',
  '先听我想做什么；在信息不足时提问，不要替我承诺客户交期、勾选作业完成或自动修改资料。',
  '本次只包含我主动选择分享的最小工作摘要，没有客户、价格、详细画稿需求、私人备注、笔记正文、PDF 或普通私聊历史。',
  JSON.stringify({
    today:localDate(now),phase,
    currentTask:session?text(taskName,96):'',
    activeCommissions:active,
    waitingForClientCount:remaining,
    pendingHomework:homework,
    dailyAvailableMinutes:data.dailyAvailableMinutes,
  }),
 ].join('\n').slice(0,7800);
}


/** Study-room coaching is LOCAL, opt-in and per-Char. It cannot schedule AMSG
 * jobs, invoke AI, read private chat, or assert work completed without a log.
 * Quiet hours use the user's device clock (the student's time, not Char time).
 */
export type CoachLevel='off'|'gentle'|'normal'|'firm';
export interface StudyCoachSetting{
 level:CoachLevel;
 quietEnabled:boolean;
 quietStart:string;
 quietEnd:string;
 paused:boolean;
}
export const DEFAULT_STUDY_COACH:Readonly<StudyCoachSetting>=Object.freeze({
 level:'off',quietEnabled:true,quietStart:'22:00',quietEnd:'08:00',paused:false,
});
const isTime=(value:unknown):value is string=>
 typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const normalizeStudyCoachSetting=(value:unknown):StudyCoachSetting=>{
 const v:Partial<StudyCoachSetting>=value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Partial<StudyCoachSetting>:{};
 return {
  level:v.level==='gentle'||v.level==='normal'||v.level==='firm'?v.level:'off',
  quietEnabled:typeof v.quietEnabled==='boolean'?v.quietEnabled:true,
  quietStart:isTime(v.quietStart)?v.quietStart:'22:00',
  quietEnd:isTime(v.quietEnd)?v.quietEnd:'08:00',
  paused:v.paused===true,
 };
};
const timeMinute=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3,5));
export const isStudyCoachQuietTime=(setting:StudyCoachSetting,now:Date):boolean=>{
 if(!setting.quietEnabled)return false;
 const start=timeMinute(setting.quietStart),end=timeMinute(setting.quietEnd);
 if(start===end)return true; // equal times: whole day quiet, not all-day reminders
 const current=now.getHours()*60+now.getMinutes();
 return start<end?current>=start&&current<end:current>=start||current<end;
};
export const STUDY_COACH_INTERVAL_MINUTES:Record<Exclude<CoachLevel,'off'>,number>={
 gentle:30,normal:15,firm:8,
};
export interface StudyCoachCheck{
 charId:string;
 setting:StudyCoachSetting;
 session:CompanionSession;
 now:Date;
 idleSince:number;
 lastPromptAt:number;
 reality?:StudyRoomReality;
 isVisible:boolean;
 isTimerTab:boolean;
}
export const nextStudyCoachPrompt=(check:StudyCoachCheck):string|null=>{
 const {charId,setting,session,now,idleSince,lastPromptAt,isVisible,isTimerTab,reality}=check;
 if(!charId||setting.level==='off'||setting.paused||!isVisible||!isTimerTab||session)return null;
 if(isStudyCoachQuietTime(setting,now))return null;
 const minutes=STUDY_COACH_INTERVAL_MINUTES[setting.level];
 const interval=minutes*60000;
 if(!Number.isFinite(idleSince)||idleSince<=0||now.getTime()-idleSince<interval)return null;
 if(Number.isFinite(lastPromptAt)&&lastPromptAt>0&&now.getTime()-lastPromptAt<interval)return null;
 // The cue is tied to a real existing task or completed record, not an imaginary
 // conversation by Char. The real personality comes from ContextBuilder only after SEND.
 const cue=reality?.unsettledLinkedMinutes
  ?'有 '+reality.unsettledLinkedMinutes+' 分钟已记录但还没有手动核对'
  :reality && reality.dueSoonHomework+reality.dueSoonCommissions>0
   ?'七天内有 '+(reality.dueSoonHomework+reality.dueSoonCommissions)+' 项待安排'
   :reality?.todayCourses?'今天有 '+reality.todayCourses+' 节课程'
   :reality?.todayFocusMinutes?'今天已记录 '+reality.todayFocusMinutes+' 分钟专注'
   :'还没有新的专注轮次';
 return setting.level==='gentle'?'提醒一下：'+cue+'。需要时再开始就好。'
  :setting.level==='normal'?cue+'。要不要一起选下一步？'
  :cue+'。需要我协助你安排下一轮吗？';
};
export const studyCoachBrief=(setting:StudyCoachSetting):string=>{
 if(setting.level==='off'||setting.paused)return '';
 return setting.level==='gentle'
  ?'本次请以温和、不催促的方式陪我，不要擅自推断我是否真的在学习。'
  :setting.level==='normal'
   ?'本次请友善地帮助我明确下一步学习目标，先询问再建议，不要代替我完成事项。'
   :'本次请帮助我检查目标、安排下一轮专注，但不要责备或擅自标记完成。';
};


/** Evidence of what happened in the WHOLE learning room, not a fabricated
 * "Char has been watching you" narrative. Derived only from local task,
 * timetable, commission and completed focus records. Never mutates anything.
 */
export interface StudyRoomFocusRecord {
 date:string;minutes:number;taskId:string;sessionId?:string;
}
export interface StudyRoomLinkedTask {
 id:string;source?:{kind:'commission'|'homework';id:string};
}
export interface StudyRoomReality {
 phase:'idle'|'focus'|'paused'|'break';
 todayFocusMinutes:number;
 completedRounds:number;
 unsettledLinkedMinutes:number;
 activeCommissions:number;
 pendingHomework:number;
 todayCourses:number;
 dueSoonCommissions:number;
 dueSoonHomework:number;
 hint:string;
}
export function buildStudyRoomReality(
 data:WorkspaceData,
 session:CompanionSession,
 taskName:string,
 records:readonly StudyRoomFocusRecord[],
 linkedTasks:readonly StudyRoomLinkedTask[],
 now=new Date(),
):StudyRoomReality {
 const day=localDate(now),end=new Date(now);
 end.setDate(end.getDate()+7);
 const endDay=localDate(end);
 const todayLogs=records.filter(r=>r.date===day && Number.isFinite(r.minutes) && r.minutes>0);
 const todayFocusMinutes=todayLogs.reduce((n,r)=>n+r.minutes,0);
 const settled=new Set(data.focusSettlements.map(s=>s.sessionId));
 const linkedIds=new Set(linkedTasks.filter(t=>t.source&&(
  t.source.kind==='commission'?data.commissions.some(c=>c.id===t.source?.id&&c.status==='active')
   :data.homework.some(h=>h.id===t.source?.id&&!h.done)
 )).map(t=>t.id));
 const unsettledLinkedMinutes=records.filter(r=>r.sessionId&&!settled.has(r.sessionId)
  &&linkedIds.has(r.taskId)&&Number.isFinite(r.minutes)&&r.minutes>0)
  .reduce((n,r)=>n+r.minutes,0);
 const activeCommissions=data.commissions.filter(c=>c.status==='active').length;
 const pendingHomework=data.homework.filter(h=>!h.done).length;
 const todayCourses=data.classes.filter(c=>!c.cancelled&&c.weekday===now.getDay()
  &&(!c.until||c.until>=day)).length;
 const dueSoonCommissions=data.commissions.filter(c=>c.status==='active'&&c.dueDate>=day&&c.dueDate<=endDay).length;
 const dueSoonHomework=data.homework.filter(h=>!h.done&&h.dueAt.slice(0,10)>=day&&h.dueAt.slice(0,10)<=endDay).length;
 const phase=session?.pauseRemainingMs!=null?'paused':session?.mode||'idle';
 const hint=phase==='focus'?'正在专注'+(taskName?' · '+taskName.slice(0,40):'')
  :phase==='paused'?'专注已暂停，进度保留'
  :phase==='break'?'正在休息，不打扰'
  :unsettledLinkedMinutes>0?'已记录 '+unsettledLinkedMinutes+' 分钟，等待手动核对'
  :todayCourses>0?'今天有 '+todayCourses+' 节课程'
  :dueSoonCommissions+dueSoonHomework>0?'七天内有 '+(dueSoonCommissions+dueSoonHomework)+' 项待安排'
  :todayFocusMinutes>0?'今天已专注 '+todayFocusMinutes+' 分钟'
  :'还没有新的专注记录';
 return {
  phase,todayFocusMinutes,completedRounds:todayLogs.length,unsettledLinkedMinutes,
  activeCommissions,pendingHomework,todayCourses,dueSoonCommissions,dueSoonHomework,hint,
 };
}


/** A contextual draft for a user-initiated conversation. This is NOT a Char
 * response; personality comes from the actual selected character's model.
 * No private data or automatic task mutations are included.
 */
export interface CompanionPdfPresence {
 courseTitle:string;chapterTitle:string;progress:number;
}
export function companionEntryPrompt(
 reality:StudyRoomReality,
 taskName='',
 pdf:CompanionPdfPresence|null=null,
 recentRoundMinutes=0,
):string {
 if(reality.phase==='focus')
  return '我正在专注'+(taskName?'处理「'+taskName.slice(0,60)+'」':'')+'。我想简短说一下卡住的地方，请先听我说，不打断本轮计时。';
 if(reality.phase==='paused')
  return '我暂停了一下当前任务'+(taskName?'「'+taskName.slice(0,60)+'」':'')+'。陪我理清卡住的地方，别替我把任务标成完成。';
 if(reality.phase==='break')
  return '现在是休息时间。我想跟你简单聊聊这一轮，先不要催我继续。';
 if(recentRoundMinutes>0)
  return '我刚完成一轮 '+recentRoundMinutes+' 分钟专注。先听我说实际做了什么，再陪我复盘，暂时不要自动结算。';
 if(pdf?.courseTitle){
  const chapter=pdf.chapterTitle?'《'+pdf.chapterTitle.slice(0,60)+'》':'这门课';
  return '我在看《'+pdf.courseTitle.slice(0,60)+'》的'+chapter+'。请用你自己的方式陪我梳理刚学的内容，先问我理解到哪里，不要假定我已学会。';
 }
 if(reality.unsettledLinkedMinutes>0)
  return '我有 '+reality.unsettledLinkedMinutes+' 分钟专注记录还没核对。陪我回顾实际进展，但不要自动扣工时或标记完成。';
 if(reality.dueSoonHomework>0||reality.dueSoonCommissions>0)
  return '接下来有 '+(reality.dueSoonHomework+reality.dueSoonCommissions)+' 项临近的学习或画稿安排。陪我一起选一件先做的，不要替我改日期。';
 if(reality.todayCourses>0)
  return '今天安排了 '+reality.todayCourses+' 节课程。帮我理一下学习顺序，先问我的状态。';
 if(reality.todayFocusMinutes>0)
  return '我今天已记录 '+reality.todayFocusMinutes+' 分钟专注。陪我回顾进展，再一起决定下一步。';
 return '陪我一起看看现在先做什么比较好？';
}

/** Display only a genuine recent AI reply from the same Char's voluntary
 * study-room overview. Do not expose a commission-specific or homework-
 * specific reply on unrelated pages, or treat old unknown-time replies as new.
 */
export function recentCompanionReply(
 notes:readonly {charId?:string;scope?:string;role?:string;content?:string;createdAt?:number}[],
 charId:string,now=Date.now(),
):string {
 if(!charId)return '';
 for(let i=notes.length-1;i>=0;i--){
  const n=notes[i];
  if(n.charId!==charId||n.scope!=='overview'||n.role!=='assistant')continue;
  const at=n.createdAt;
  if(typeof at!=='number'||!Number.isFinite(at)||at<=0||now-at<0||now-at>10*60000)return '';
  const snippet=(n.content||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,54);
  return snippet?snippet+(n.content!.trim().length>54?'…':''):'';
 }
 return '';
}
