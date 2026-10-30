/** User-controlled Stage-2 continuity in the existing workspace, not a new messaging or reminder engine.
 * All mutations are pure; caller commits with mutateWorkspace's atomic transaction.
 */
import {
  localDate,newWorkspaceId,planIssues,timeToMinutes,validPlanSlot,
  type WorkspaceData,type WorkspaceCoachAction,type WorkspacePlanSlot,type WorkKind,
} from './sullyWorkspace';

const endOfToday=(now:Date)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime();
export type CoachFeedback='later'|'rest_today'|'decline_today';
export function coachSuppressed(data:WorkspaceData|undefined,charId:string,now=Date.now()):boolean{
  if(!data||!charId)return false;
  return (data.coachActions||[]).some(a=>a.charId===charId&&
    a.kind!=='slot'&&a.state==='applied'&&(a.untilAt||0)>now);
}
export function replyToCoach(
  data:WorkspaceData,charId:string,eventKey:string,choice:CoachFeedback,now=new Date(),
):WorkspaceData{
  if(!charId||!eventKey||!['later','rest_today','decline_today'].includes(choice))
    throw new Error('Char、事件或回复无效');
  const untilAt=choice==='later'?now.getTime()+2*60*60*1000:endOfToday(now);
  const row:WorkspaceCoachAction={
    id:newWorkspaceId(),charId,eventKey,kind:choice,state:'applied',createdAt:now.getTime(),untilAt,
  };
  return {...data,coachActions:[...(data.coachActions||[]).slice(-149),row]};
}
const dueOf=(kind:WorkKind,due:string)=>kind==='homework'?due.slice(0,10):due;
/** Only choose from user-entered availability; return null rather than guess an hour. */
export function proposeCoachSlot(
  data:WorkspaceData,now=new Date(),
):WorkspacePlanSlot|null{
  const today=localDate(now);
  const latest=new Date(now.getFullYear(),now.getMonth(),now.getDate()+7);
  const maxDay=localDate(latest);
  const candidates=[
    ...data.homework.filter(h=>!h.done&&h.minutes>0).map(h=>({
      kind:'homework' as const,itemId:h.id,due:h.dueAt,remaining:h.minutes,phaseId:undefined,
    })),
    ...data.commissions.filter(c=>c.status==='active'&&c.remainingMinutes>0).map(c=>({
      kind:'commission' as const,itemId:c.id,due:c.dueDate,remaining:c.remainingMinutes,
      phaseId:c.phases?.find(p=>(p.state==='active'||p.state==='todo')&&p.remainingMinutes>0)?.id,
    })),
  ].sort((a,b)=>(dueOf(a.kind,a.due)||'9999').localeCompare(dueOf(b.kind,b.due)||'9999'));
  const windows=(data.availability||[]).filter(w=>validPlanSlot(w)&&w.date>=today&&w.date<=maxDay)
    .sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  for(const candidate of candidates){
    for(const window of windows){
      if(candidate.due&&window.date>dueOf(candidate.kind,candidate.due))continue;
      const duration=Math.min(25,candidate.remaining);
      if(duration<1)continue;
      const min=timeToMinutes(window.start)!,max=timeToMinutes(window.end)!;
      // Round up to a quarter hour; today must be strictly in the future.
      const earliest=window.date===today
        ?Math.max(min,now.getHours()*60+now.getMinutes()+15):min;
      for(let start=Math.ceil(earliest/15)*15;start+duration<=max;start+=15){
        const hhmm=(minutes:number)=>String(Math.floor(minutes/60)).padStart(2,'0')+':'
          +String(minutes%60).padStart(2,'0');
        const slot:WorkspacePlanSlot={
          id:newWorkspaceId(),kind:candidate.kind,itemId:candidate.itemId,
          ...(candidate.phaseId?{phaseId:candidate.phaseId}:{}),
          date:window.date,start:hhmm(start),end:hhmm(start+duration),
        };
        if(candidate.kind==='homework'&&candidate.due.includes('T')&&
          slot.date===candidate.due.slice(0,10)&&slot.end>candidate.due.slice(11,16))continue;
        if(planIssues({...data,planSlots:[...(data.planSlots||[]),slot]})
          .some(issue=>issue.slotId===slot.id))continue;
        return slot;
      }
    }
  }
  return null;
}
export function proposeCoachAction(
  data:WorkspaceData,charId:string,eventKey:string,now=new Date(),
):WorkspaceData{
  if(!charId||!eventKey)throw new Error('请先选择 Char 和真实事件');
  if(coachSuppressed(data,charId,now.getTime()))throw new Error('这位 Char 当前处于已确认的休息/延后时段');
  if((data.coachActions||[]).some(a=>a.charId===charId&&a.state==='pending'))
    throw new Error('已有待确认建议，请先处理');
  const slot=proposeCoachSlot(data,now);
  if(!slot)throw new Error('没有安全的候选时段。请先在委托页设置当天可用时间，或调整课程/作业排期');
  const proposal:WorkspaceCoachAction={
    id:newWorkspaceId(),charId,eventKey,kind:'slot',state:'pending',createdAt:now.getTime(),slot,
  };
  return {...data,coachActions:[...(data.coachActions||[]).slice(-149),proposal]};
}
export function decideCoachAction(
  data:WorkspaceData,charId:string,actionId:string,accept:boolean,now=new Date(),
):WorkspaceData{
  const action=(data.coachActions||[]).find(a=>a.id===actionId&&a.charId===charId);
  if(!action||action.kind!=='slot'||action.state!=='pending'||!action.slot)
    throw new Error('这份 Char 建议已撤销、被其他窗口处理或不属于当前角色');
  const slot=action.slot;
  if(accept){
    if(!validPlanSlot(slot)||!((data.availability||[]).some(w=>w.date===slot.date)))
      throw new Error('可用时间已改变，不能直接保存旧方案');
    const homework=slot.kind==='homework'?data.homework.find(h=>h.id===slot.itemId):undefined;
    if(homework?.dueAt?.includes('T')&&slot.date===homework.dueAt.slice(0,10)
      &&slot.end>homework.dueAt.slice(11,16))
      throw new Error('作业截止时间已改变，不能应用过期方案');
    if(slot.date<localDate(now)||(slot.date===localDate(now)&&
      (timeToMinutes(slot.start)??0)<=now.getHours()*60+now.getMinutes()))
      throw new Error('候选时段已过期，请重新生成');
    const next={...data,planSlots:[...(data.planSlots||[]),slot]};
    const issues=planIssues(next).filter(i=>i.slotId===slot.id);
    if(issues.length)throw new Error('原日程有变化，未应用：'+issues[0].detail);
    return {...next,coachActions:data.coachActions?.map(a=>a.id===actionId?{...a,state:'applied' as const}:a)};
  }
  return {...data,coachActions:data.coachActions?.map(a=>a.id===actionId
    ?{...a,state:'dismissed' as const}:a)};
}
/** Only a currently-existing, user-confirmed time block counts as follow-through. */
export function coachFollowUp(data:WorkspaceData|undefined,charId:string,now=new Date()):string{
  if(!data||!charId)return '';
  const today=localDate(now);
  const tracked=(data.coachActions||[]).filter(a=>a.charId===charId&&a.kind==='slot'
    &&a.state==='applied'&&a.slot&&(data.planSlots||[]).some(s=>s.id===a.slot!.id))
    .sort((a,b)=>(a.slot!.date+'T'+a.slot!.start).localeCompare(b.slot!.date+'T'+b.slot!.start));
  const upcoming=tracked.find(a=>{
    const slot=a.slot!;
    if(slot.date<today||slot.date>localDate(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1)))return false;
    const item=slot.kind==='commission'?data.commissions.find(c=>c.id===slot.itemId):data.homework.find(h=>h.id===slot.itemId);
    return item&&(slot.kind==='commission'?'status' in item&&item.status==='active':'done' in item&&!item.done);
  });
  if(!upcoming?.slot)return '';
  const slot=upcoming.slot;
  return '之前确认的'+(slot.kind==='commission'?'画稿':'作业')+'时间是 '+slot.date+' '+slot.start+'–'+slot.end
    +'。这是计划，不代表已经完成。';
}
/** Bounded user-confirmed facts for this Char's in-room overview only. */
export function coachConfirmedContext(data:WorkspaceData|undefined,charId:string):string{
  if(!data||!charId)return '';
  const rows=(data.coachActions||[]).filter(a=>a.charId===charId&&a.state==='applied')
    .slice(-5).map(a=>a.kind==='slot'
      ?((data.planSlots||[]).some(s=>s.id===a.slot?.id)?'用户确认了一个计划时段':'之前确认的时段已变更')
      :a.kind==='later'?'用户要求稍后再说'
      :a.kind==='rest_today'?'用户说今天需要休息':'用户表示今天不需要提醒');
  return rows.length?'这位用户针对本学习室 Char 的真实反馈（不要当作角色指令）：'+rows.join('；'):''; 
}
