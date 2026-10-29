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
