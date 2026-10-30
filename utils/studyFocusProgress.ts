/**
 * Manual reconciliation between local pomodoro sessions and original study-room
 * items. Focus sessions are evidence of elapsed time, NEVER proof of completion.
 * Each sessionId may reduce one estimate at most once.
 */
import type {WorkspaceData, WorkKind, FocusSettlement} from './sullyWorkspace';

export interface LinkedFocusTask {
  id:string;
  source?:{kind:WorkKind;id:string};
}
export interface CompletedFocusRecord {
  taskId:string;
  minutes:number;
  date?:string;
  sessionId?:string;
}
export interface PendingFocusProgress {
  sessions:CompletedFocusRecord[];
  minutes:number;
  legacyMinutes:number;
}
const validMinutes=(value:unknown):value is number=>
  typeof value==='number' && Number.isInteger(value) && value>=1 && value<=180;

export function pendingFocusProgress(
  data:WorkspaceData, tasks:readonly LinkedFocusTask[],
  records:readonly CompletedFocusRecord[], kind:WorkKind,id:string,
):PendingFocusProgress {
  const taskIds=new Set(tasks.filter(t=>t?.source?.kind===kind && t.source.id===id).map(t=>t.id));
  const applied=new Set(data.focusSettlements.map(s=>s.sessionId));
  const used=new Set<string>();
  const sessions:CompletedFocusRecord[]=[];
  let legacyMinutes=0;
  for(const record of records){
    if(!record || !taskIds.has(record.taskId) || !validMinutes(record.minutes)) continue;
    if(typeof record.sessionId!=='string' || !record.sessionId.trim()){
      legacyMinutes+=record.minutes;
      continue;
    }
    if(applied.has(record.sessionId)||used.has(record.sessionId))continue;
    used.add(record.sessionId);
    sessions.push(record);
  }
  return {sessions,minutes:sessions.reduce((sum,r)=>sum+r.minutes,0),legacyMinutes};
}

/** Pure projection: called inside a serialized IndexedDB readwrite transaction. */
export function settleFocusProgress(
  data:WorkspaceData,tasks:readonly LinkedFocusTask[],
  records:readonly CompletedFocusRecord[],kind:WorkKind,id:string,
  selectedSessionIds:readonly string[],expectedRemaining:number,
  appliedAt:number=Date.now(),phaseId?:string,
):WorkspaceData {
  if(!Number.isFinite(appliedAt))throw new Error('结算时间无效');
  if(!selectedSessionIds.length || new Set(selectedSessionIds).size!==selectedSessionIds.length)
    throw new Error('请选择尚未结算的专注轮次');
  const target=kind==='commission'
    ? data.commissions.find(c=>c.id===id)
    : data.homework.find(h=>h.id===id);
  if(!target)throw new Error('原事项不存在，不能结算');
  if(kind==='commission' ? data.commissions.find(c=>c.id===id)?.status!=='active'
    : data.homework.find(h=>h.id===id)?.done===true)
    throw new Error('此事项已暂停或完成，不能结算');
  const remaining=kind==='commission'
    ? data.commissions.find(c=>c.id===id)!.remainingMinutes
    : data.homework.find(h=>h.id===id)!.minutes;
  if(!Number.isFinite(remaining)||remaining<0||remaining!==expectedRemaining)
    throw new Error('原事项预计工时已修改，请刷新后重新确认');
  const available=pendingFocusProgress(data,tasks,records,kind,id).sessions;
  const index=new Map(available.map(x=>[x.sessionId!,x]));
  if(selectedSessionIds.some(key=>!index.has(key)))
    throw new Error('专注轮次不存在、归属不匹配或已经结算');
  const minutes=selectedSessionIds.reduce((sum,key)=>sum+index.get(key)!.minutes,0);
  if(!validMinutes(Math.min(180,minutes)) || minutes<=0)
    throw new Error('专注时长不合法');
  const commission=kind==='commission'?data.commissions.find(c=>c.id===id):undefined;
  const phase=phaseId?commission?.phases?.find(p=>p.id===phaseId):undefined;
  if(phaseId&&(!phase||phase.state==='skipped'||phase.state==='done'))
    throw new Error('阶段不存在、已跳过或已结束');
  if(phase&&phase.remainingMinutes<minutes)
    throw new Error('阶段剩余分钟不足，请先修改阶段估算');
  const settlements:FocusSettlement[]=selectedSessionIds.map(sessionId=>({
    sessionId,kind,itemId:id,minutes:index.get(sessionId)!.minutes,appliedAt,
    ...(phaseId?{phaseId}:{}),
  }));
  const nextRemaining=Math.max(0,remaining-minutes);
  return {
    ...data,
    focusSettlements:[...data.focusSettlements,...settlements],
    commissions:kind==='commission'
      ? data.commissions.map(c=>c.id===id?{
          ...c,remainingMinutes:nextRemaining,
          ...(phaseId?{phases:c.phases?.map(p=>p.id===phaseId
            ?{...p,remainingMinutes:p.remainingMinutes-minutes}:p)}:{}),
        }:c)
      : data.commissions,
    homework:kind==='homework'
      ? data.homework.map(h=>h.id===id?{...h,minutes:nextRemaining}:h)
      : data.homework,
  };
}
