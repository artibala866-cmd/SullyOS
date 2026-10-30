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
 const v=value&&typeof value==='object'?value as Partial<StudyCoachSetting>:{};
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
 isVisible:boolean;
 isTimerTab:boolean;
}
export const nextStudyCoachPrompt=(check:StudyCoachCheck):string|null=>{
 const {charId,setting,session,now,idleSince,lastPromptAt,isVisible,isTimerTab}=check;
 if(!charId||setting.level==='off'||setting.paused||!isVisible||!isTimerTab||session)return null;
 if(isStudyCoachQuietTime(setting,now))return null;
 const minutes=STUDY_COACH_INTERVAL_MINUTES[setting.level];
 const interval=minutes*60000;
 if(!Number.isFinite(idleSince)||idleSince<=0||now.getTime()-idleSince<interval)return null;
 if(Number.isFinite(lastPromptAt)&&lastPromptAt>0&&now.getTime()-lastPromptAt<interval)return null;
 // Never guess whether the user is actually studying off-screen.
 return setting.level==='gentle'
  ?'还没开始新的专注轮次。想好了再开始也可以。'
  :setting.level==='normal'
   ?'还没有新的计时记录。要不要选一件事开始？'
   :'还没开始新一轮专注。需要我陪你确定下一步吗？';
};
export const studyCoachBrief=(setting:StudyCoachSetting):string=>{
 if(setting.level==='off'||setting.paused)return '';
 return setting.level==='gentle'
  ?'本次请以温和、不催促的方式陪我，不要擅自推断我是否真的在学习。'
  :setting.level==='normal'
   ?'本次请友善地帮助我明确下一步学习目标，先询问再建议，不要代替我完成事项。'
   :'本次请帮助我检查目标、安排下一轮专注，但不要责备或擅自标记完成。';
};
