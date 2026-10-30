/**
 * 学习室本地数据。独立于旧 StudyCourse / sully_pomodoro_v1。
 * 存在现有 assets IndexedDB store，随完整备份导出，不读取普通私聊。
 */
import { DB } from './db';

export const WORKSPACE_ASSET_ID = 'sully_workspace_v1';
export const DEFAULT_STAGES = ['待确认', '排队', '草稿', '线稿', '上色', '细化', '待审核', '交付完成'] as const;
export type WorkKind = 'commission' | 'homework';
export type WorkStatus = 'active' | 'waiting' | 'paused' | 'delivered' | 'cancelled' | 'archived';

export type CommissionPhaseState='todo'|'active'|'waiting'|'skipped'|'done';
export interface CommissionPhase {id:string;title:string;remainingMinutes:number;bufferMinutes:number;state:CommissionPhaseState}
export interface WorkspacePlanSlot {id:string;kind:WorkKind;itemId:string;phaseId?:string;date:string;start:string;end:string}
export interface WorkspaceAvailability {id:string;date:string;start:string;end:string}
export interface ExecutionPlanIssue {slotId:string;code:'invalid'|'overlap'|'class'|'outside_availability'|'over_capacity'|'inactive';detail:string}
export const timeToMinutes=(s:string):number|null=>{
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))return null;
  const [h,m]=s.split(':').map(Number);return h*60+m;
};
export const isValidDay=(s:string):boolean=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
};
export const planSlotMinutes=(s:Pick<WorkspacePlanSlot,'start'|'end'>):number=>{
  const a=timeToMinutes(s.start),b=timeToMinutes(s.end);return a===null||b===null||b<=a?0:b-a;
};
export const validPlanSlot=(s:Pick<WorkspacePlanSlot,'date'|'start'|'end'>)=>isValidDay(s.date)&&planSlotMinutes(s)>0;
/** Check concrete time collisions; does not infer any time slot from daily budget alone. */
export function planIssues(data:WorkspaceData):ExecutionPlanIssue[]{
  const issues:ExecutionPlanIssue[]=[];
  const slots=data.planSlots||[],availability=data.availability||[];
  for(const slot of slots){
    const duration=planSlotMinutes(slot),a=timeToMinutes(slot.start),b=timeToMinutes(slot.end);
    if(!validPlanSlot(slot)||a===null||b===null){
      issues.push({slotId:slot.id,code:'invalid',detail:'无效计划日期或时段'});continue;
    }
    const commission=slot.kind==='commission'?data.commissions.find(c=>c.id===slot.itemId):undefined;
    const homework=slot.kind==='homework'?data.homework.find(h=>h.id===slot.itemId):undefined;
    if(commission?.dueDate&&slot.date>commission.dueDate)
      issues.push({slotId:slot.id,code:'invalid',detail:'已超过画稿约定交期'});
    if(homework?.dueAt&&slot.date>homework.dueAt.slice(0,10))
      issues.push({slotId:slot.id,code:'invalid',detail:'已超过作业交期'});
    if(!((commission&&commission.status==='active')||(homework&&!homework.done))||
      (slot.phaseId&&(!commission?.phases?.some(p=>p.id===slot.phaseId&&p.state!=='done'&&p.state!=='skipped'))))
      issues.push({slotId:slot.id,code:'inactive',detail:'事项或阶段已暂停、结束或不存在'});
    if(slots.some(other=>other.id!==slot.id&&other.date===slot.date&&
      (timeToMinutes(other.start)??1440)<b&&(timeToMinutes(other.end)??0)>a))
      issues.push({slotId:slot.id,code:'overlap',detail:'与其他画稿或作业时段重叠'});
    const date=new Date(slot.date+'T12:00:00');
    if(data.classes.some(c=>!c.cancelled&&c.weekday===date.getDay()&&(!c.until||slot.date<=c.until)
      &&(timeToMinutes(c.start)??1440)<b&&(timeToMinutes(c.end)??0)>a))
      issues.push({slotId:slot.id,code:'class',detail:'与现实课程时间重叠'});
    const windows=availability.filter(w=>w.date===slot.date&&planSlotMinutes(w)>0)
      .map(w=>({a:Math.max(a,timeToMinutes(w.start)!),b:Math.min(b,timeToMinutes(w.end)!)}))
      .filter(w=>w.b>w.a).sort((x,y)=>x.a-y.a);
    if(availability.some(w=>w.date===slot.date)){
      let covered=0,end=0;for(const w of windows){covered+=Math.max(0,w.b-Math.max(end,w.a));end=Math.max(end,w.b);}
      if(covered<duration)issues.push({slotId:slot.id,code:'outside_availability',detail:'不在当天设置的可用时间内'});
    }
    const total=slots.filter(x=>x.date===slot.date).reduce((sum,x)=>sum+planSlotMinutes(x),0);
    if(total>data.dailyAvailableMinutes)
      issues.push({slotId:slot.id,code:'over_capacity',detail:'当天已排时长超出日预算'});
  }
  return issues;
}
export interface Commission {
  id: string;
  title: string;
  client: string;
  type: string;
  brief: string;
  acceptedAt: string;
  dueDate: string;
  stage: string;
  phases?: CommissionPhase[]; // Legacy stage stays authoritative until user creates phases.
  priority: number;
  status: WorkStatus;
  remainingMinutes: number;
  bufferMinutes: number;
  plannedDate: string;
  price: string;
  paid: boolean;
  note: string;
  order: number;
}

export interface TimetableClass {
  id: string;
  name: string;
  weekday: number; // 0=周日；每周重复，独立于原 StudyCourse
  start: string;
  end: string;
  until: string;
  teacher: string;
  location: string;
  note: string;
  sourceImageRef?: string;
  studyCourseId?: string;
  cancelled?: boolean;
}
export interface ClassHomework {
  id: string;
  classId: string;
  title: string;
  dueAt: string;
  minutes: number;
  done: boolean;
  note: string;
}
export interface ClassNote {
  id: string;
  classId: string;
  body: string;
  createdAt: number;
}
export interface FocusSettlement {
  sessionId:string;
  kind:WorkKind;
  itemId:string;
  minutes:number;
  appliedAt:number;
  phaseId?:string;
}
export type WorkspaceReminderKind = 'commission' | 'homework';
export type WorkspaceReminderStatus = 'creating' | 'scheduled' | 'cancel_failed' | 'needs_review';
/** Separate local link: never injected into normal private-chat context. */
export interface WorkspaceReminder {
  id: string;
  kind: WorkspaceReminderKind;
  itemId: string;
  charId: string;
  fireAt: string; // absolute ISO from the user's local datetime picker
  taskUuid?: string;
  clientTaskId?: string;
  status: WorkspaceReminderStatus;
  error?: string;
}
/** Per-Char, per-category positive consent. Missing/legacy settings always deny. */
export interface WorkspaceChatPermissions { study: boolean; commissions: boolean; }
export type WorkspaceShareCategory = keyof WorkspaceChatPermissions;
export const deniedWorkspaceChatPermissions = (): WorkspaceChatPermissions => ({
  study: false, commissions: false,
});
export const permissionForChar = (
  data: WorkspaceData, charId: string,
): WorkspaceChatPermissions => {
  if (!charId) return deniedWorkspaceChatPermissions();
  const stored = data.privateChatPermissions?.[charId];
  return {
    study: stored?.study === true,
    commissions: stored?.commissions === true,
  };
};

export interface WorkspaceData {
  /** Authorization map is not exported in private chat and is local-only. */
  privateChatPermissions: Record<string, WorkspaceChatPermissions>;
  reminders: WorkspaceReminder[];
  /** User-approved applied focus sessions; not generated by AI or a timer event. */
  focusSettlements: FocusSettlement[];
  commissions: Commission[];
  classes: TimetableClass[];
  homework: ClassHomework[];
  notes: ClassNote[];
  dailyAvailableMinutes: number; // 绘画与学习共同的日可用预算
  planSlots?: WorkspacePlanSlot[];
  availability?: WorkspaceAvailability[];
}
export const emptyWorkspace = (): WorkspaceData => ({
  commissions: [], classes: [], homework: [], notes: [], reminders: [],
  focusSettlements: [], privateChatPermissions: {}, dailyAvailableMinutes: 240,
  planSlots: [], availability: [],
});
export const localDate = (date: Date): string =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
export const newWorkspaceId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);


const isRow=(value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==='object' && !Array.isArray(value);
const asText=(value:unknown,fallback=''):string=>typeof value==='string'?value:fallback;
const asNumber=(value:unknown,fallback=0):number=>
  typeof value==='number' && Number.isFinite(value)?value:fallback;
function normalizedRows<T extends {id:string}>(
  raw:unknown,clean:(row:Record<string,unknown>)=>T,
):T[] {
  if(!Array.isArray(raw))return [];
  const seen=new Set<string>(),rows:T[]=[];
  for(const item of raw) {
    if(!isRow(item)||typeof item.id!=='string'||!item.id.trim()
      ||seen.has(item.id))continue;
    seen.add(item.id);rows.push(clean(item));
  }
  return rows;
}
/** Keep raw damaged records in IndexedDB; refuse any write until recovery. */
export function workspaceIntegrityWarnings(raw:unknown):string[] {
  if(raw==null)return [];
  if(!isRow(raw))return ['工作空间根记录不是有效对象'];
  const issues:string[]=[];
  const required:Record<string,string[]>={
    commissions:['title','status','dueDate'],classes:['name','start','end'],
    homework:['title','classId','dueAt'],notes:['classId','body'],
    reminders:['kind','itemId','charId','fireAt','status'],
  };
  for(const [field,keys] of Object.entries(required)){
    const entries=raw[field];
    if(entries===undefined)continue;
    if(!Array.isArray(entries)){issues.push(field+'不是数组');continue;}
    const seen=new Set<string>();
    entries.forEach((item,index)=>{
      if(!isRow(item)||typeof item.id!=='string'||!item.id.trim()
        ||seen.has(item.id))issues.push(field+'第'+(index+1)+'条 ID 无效或重复');
      else {
        seen.add(item.id);
        if(keys.some(key=>typeof item[key]!=='string')
          || (field==='reminders' && (
            !['commission','homework'].includes(asText(item.kind))
            || !['creating','scheduled','cancel_failed','needs_review'].includes(asText(item.status))
          ))
          || (field==='commissions' && !['active','waiting','paused','delivered','cancelled','archived']
            .includes(asText(item.status)))
          || (field==='homework' && item.done!==undefined && typeof item.done!=='boolean'))
          issues.push(field+'第'+(index+1)+'条缺少关键字段或状态不合法');
      }
    });
  }
  if(raw.focusSettlements!==undefined){
    if(!Array.isArray(raw.focusSettlements))issues.push('focusSettlements不是数组');
    else {
      const seen=new Set<string>();
      raw.focusSettlements.forEach((entry,index)=>{
        if(!isRow(entry)||typeof entry.sessionId!=='string'||!entry.sessionId.trim()
          ||seen.has(entry.sessionId)
          || !['commission','homework'].includes(asText(entry.kind))
          || typeof entry.itemId!=='string'||!entry.itemId
          || typeof entry.minutes!=='number'||!Number.isInteger(entry.minutes)
          || entry.minutes<=0||entry.minutes>180
          || typeof entry.appliedAt!=='number'||!Number.isFinite(entry.appliedAt))
          issues.push('focusSettlements第'+(index+1)+'条结算记录无效或重复');
        else seen.add(entry.sessionId);
      });
    }
  }
  for(const field of ['planSlots','availability'] as const){
    if(raw[field]!==undefined&&(!Array.isArray(raw[field])||
      (raw[field] as unknown[]).some(row=>!isRow(row)||typeof row.id!=='string'||
        typeof row.date!=='string'||typeof row.start!=='string'||typeof row.end!=='string')))
      issues.push(field+'包含无效时段');
  }
  return issues;
}
export function normalizeWorkspace(raw:unknown):WorkspaceData {
  const fallback=emptyWorkspace();
  if(!isRow(raw))return fallback;
  const permissions=raw.privateChatPermissions;
  return {
    commissions:normalizedRows(raw.commissions,row=>({
      ...row,id:row.id as string,title:asText(row.title,'未命名委托'),
      client:asText(row.client),type:asText(row.type),brief:asText(row.brief),
      acceptedAt:asText(row.acceptedAt),dueDate:asText(row.dueDate),
      stage:asText(row.stage,'草稿'),
      phases:Array.isArray(row.phases)?normalizedRows(row.phases,p=>({
        id:p.id as string,title:asText(p.title,'未命名阶段'),
        remainingMinutes:Math.max(0,asNumber(p.remainingMinutes)),
        bufferMinutes:Math.max(0,asNumber(p.bufferMinutes)),
        state:['todo','active','waiting','skipped','done'].includes(asText(p.state))
          ?p.state as CommissionPhaseState:'todo',
      })):undefined,
      priority:asNumber(row.priority,2),
      status:['active','waiting','paused','delivered','cancelled','archived']
        .includes(asText(row.status))?row.status as WorkStatus:'paused',
      remainingMinutes:Math.max(0,asNumber(row.remainingMinutes)),
      bufferMinutes:Math.max(0,asNumber(row.bufferMinutes)),
      plannedDate:asText(row.plannedDate),price:asText(row.price),
      paid:row.paid===true,note:asText(row.note),order:asNumber(row.order),
    })),
    classes:normalizedRows(raw.classes,row=>({
      ...row,id:row.id as string,name:asText(row.name,'未命名课程'),
      weekday:asNumber(row.weekday,-1),start:asText(row.start),
      end:asText(row.end),until:asText(row.until),teacher:asText(row.teacher),
      location:asText(row.location),note:asText(row.note),
      studyCourseId:asText(row.studyCourseId)||undefined,
    })),
    homework:normalizedRows(raw.homework,row=>({
      ...row,id:row.id as string,classId:asText(row.classId),
      title:asText(row.title,'未命名作业'),dueAt:asText(row.dueAt),
      minutes:Math.max(0,asNumber(row.minutes,60)),
      done:row.done===true,note:asText(row.note),
    })),
    notes:normalizedRows(raw.notes,row=>({
      ...row,id:row.id as string,classId:asText(row.classId),
      body:asText(row.body),createdAt:asNumber(row.createdAt),
    })),
    reminders:normalizedRows(raw.reminders,row=>({
      ...row,id:row.id as string,
      kind:row.kind==='commission'?'commission':'homework',
      itemId:asText(row.itemId),charId:asText(row.charId),
      fireAt:asText(row.fireAt),taskUuid:asText(row.taskUuid)||undefined,
      clientTaskId:asText(row.clientTaskId)||undefined,
      status:['creating','scheduled','cancel_failed','needs_review']
        .includes(asText(row.status))?row.status as WorkspaceReminderStatus:'needs_review',
      error:asText(row.error)||undefined,
    })),
    focusSettlements:Array.isArray(raw.focusSettlements)
      ? raw.focusSettlements.filter((row:unknown):row is FocusSettlement=>
        isRow(row) && typeof row.sessionId==='string' && !!row.sessionId
        && (row.kind==='commission'||row.kind==='homework')
        && typeof row.itemId==='string' && !!row.itemId
        && typeof row.minutes==='number' && Number.isInteger(row.minutes)
        && row.minutes>0 && row.minutes<=180
        && typeof row.appliedAt==='number' && Number.isFinite(row.appliedAt))
      : [],
    privateChatPermissions:isRow(permissions)
      ? Object.fromEntries(Object.entries(permissions).filter(([id])=>!!id)
        .map(([id,value])=>[id,{
          study:isRow(value)&&value.study===true,
          commissions:isRow(value)&&value.commissions===true,
        }])):{},
    planSlots:normalizedRows(raw.planSlots,row=>({
      id:row.id as string,kind:row.kind==='homework'?'homework':'commission',itemId:asText(row.itemId),
      phaseId:asText(row.phaseId)||undefined,date:asText(row.date),start:asText(row.start),end:asText(row.end),
    })),
    availability:normalizedRows(raw.availability,row=>({
      id:row.id as string,date:asText(row.date),start:asText(row.start),end:asText(row.end),
    })),
    dailyAvailableMinutes:typeof raw.dailyAvailableMinutes==='number' && Number.isFinite(raw.dailyAvailableMinutes)
      ? Math.max(0,Math.min(1440,Number(raw.dailyAvailableMinutes))):fallback.dailyAvailableMinutes,
  };
}
// Local queue handles same-tab edit order. Atomic DB transaction protects other tabs.
let pendingSave:Promise<void>=Promise.resolve();
export async function readWorkspace():Promise<WorkspaceData>{
  await pendingSave.catch(()=>{});
  return normalizeWorkspace(await DB.getAssetRaw(WORKSPACE_ASSET_ID));
}
export async function readWorkspaceIntegrityWarnings():Promise<string[]>{
  await pendingSave.catch(()=>{});
  return workspaceIntegrityWarnings(await DB.getAssetRaw(WORKSPACE_ASSET_ID));
}
export function writeWorkspace(workspace:WorkspaceData):Promise<void>{
  const action=pendingSave.catch(()=>{}).then(async()=>{
    await DB.updateAssetRaw(WORKSPACE_ASSET_ID,raw=>{
      const warnings=workspaceIntegrityWarnings(raw);
      if(warnings.length)throw new Error('原工作空间存在损坏记录，拒绝覆盖：'+warnings[0]);
      return workspace;
    });
  });
  pendingSave=action;return action;
}
/** The updater MUST be synchronous: get and put share one IndexedDB readwrite txn. */
export async function mutateWorkspace(
  update:(prev:WorkspaceData)=>WorkspaceData,
):Promise<WorkspaceData>{
  let saved:WorkspaceData|undefined;
  const action=pendingSave.catch(()=>{}).then(async()=>{
    saved=await DB.updateAssetRaw(WORKSPACE_ASSET_ID,raw=>{
      const warnings=workspaceIntegrityWarnings(raw);
      if(warnings.length)throw new Error('备份有损坏记录，拒绝自动覆盖原始数据：'+warnings[0]);
      return update(normalizeWorkspace(raw));
    });
  });
  pendingSave=action;
  await action;
  return saved!;
}

/**
 * Destructive repair requires an explicit UI confirmation. The unmodified
 * source record is snapshotted in the same IDB transaction before replacing
 * the workspace with its valid/sanitized entries.
 */
export async function recoverDamagedWorkspace(
  confirmation:string,
):Promise<{workspace:WorkspaceData;snapshotId:string;warnings:string[]}> {
  if(confirmation!=='确认恢复并保留原件')
    throw new Error('必须先人工确认备份恢复');
  const snapshotId='sully_workspace_recovery_'+newWorkspaceId();
  let warnings:string[]=[];
  let workspace:WorkspaceData|undefined;
  const action=pendingSave.catch(()=>{}).then(async()=>{
    workspace=await DB.recoverAssetRawWithSnapshot(WORKSPACE_ASSET_ID,snapshotId,raw=>{
      warnings=workspaceIntegrityWarnings(raw);
      if(!warnings.length)throw new Error('原工作空间没有发现需恢复的损坏记录');
      return normalizeWorkspace(raw);
    });
  });
  pendingSave=action;
  await action;
  return {workspace:workspace!,snapshotId,warnings};
}

/** 优先按手动队列顺序；风险统计则必须按真实截止日期排序。 */
export function orderedCommissions(items: Commission[], includeArchived = false): Commission[] {
  return [...items].filter(c => includeArchived || c.status !== 'archived')
    .sort((a, b) => a.order - b.order || a.dueDate.localeCompare(b.dueDate));
}
export interface PlanRisk {
  commissionId: string;
  requiredMinutes: number;
  availableMinutes: number;
  shortfallMinutes: number;
}
/** Count overlapping lessons only once; reject malformed time ranges. */
export function busyClassMinutesForDay(classes: readonly TimetableClass[],day: Date):number {
  const dateKey=localDate(day);
  const minutes=(value:string):number|null=>{
    if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
    const [h,m]=value.split(':').map(Number);
    return h*60+m;
  };
  const spans=classes.filter(c=>c && !c.cancelled && c.weekday===day.getDay()
      && (!c.until || dateKey<=c.until)).map(c=>({
    start:minutes(c.start),end:minutes(c.end),
  })).filter((span):span is {start:number;end:number}=>
    span.start!==null && span.end!==null && span.end>span.start)
    .sort((a,b)=>a.start-b.start);
  let busy=0,end=0;
  for(const span of spans){
    busy+=Math.max(0,span.end-Math.max(end,span.start));
    end=Math.max(end,span.end);
  }
  return busy;
}

export interface DailyCapacity {
  date:string;
  classMinutes:number;
  homeworkMinutes:number;
  overdueHomeworkMinutes:number;
  availableMinutes:number;
  overbookedMinutes:number;
  unscheduledHomeworkCount:number;
}
/**
 * Daily ESTIMATE, not an hourly booking calendar. Today absorbs overdue
 * homework once; undated homework is visibly counted but not given invented
 * slots. Overlapping classes already use busyClassMinutesForDay.
 */
export function dailyCapacityForecast(
  workspace:WorkspaceData,fromDate=localDate(new Date()),days=7,
):DailyCapacity[] {
  const start=new Date(fromDate+'T12:00:00');
  if(!Number.isFinite(start.getTime()))return [];
  const count=Math.max(0,Math.min(366,Math.floor(days)));
  const incomplete=workspace.homework.filter(h=>h && !h.done);
  const validDue=(value:unknown):value is string=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value))
      return false;
    const key=value.slice(0,10);
    const d=new Date(key+'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===key;
  };
  const unscheduledHomeworkCount=incomplete.filter(h=>!validDue(h.dueAt)).length;
  const bookedHomework=(h:ClassHomework)=>Math.min(Math.max(0,h.minutes||0),
    (workspace.planSlots||[]).filter(slot=>slot.kind==='homework'&&slot.itemId===h.id
      &&validPlanSlot(slot)&&(!validDue(h.dueAt)||slot.date<=h.dueAt.slice(0,10)))
      .reduce((sum,slot)=>sum+planSlotMinutes(slot),0));
  const overdueHomeworkMinutes=incomplete.filter(h=>validDue(h.dueAt)
    && h.dueAt.slice(0,10)<fromDate)
    .reduce((sum,h)=>sum+Math.max(0,h.minutes-bookedHomework(h)),0);
  const result:DailyCapacity[]=[];
  for(let i=0;i<count;i++){
    const date=new Date(start);
    date.setDate(start.getDate()+i);
    const key=localDate(date);
    const windows=(workspace.availability||[]).filter(w=>w.date===key&&planSlotMinutes(w)>0);
    const classMinutes=windows.length
      ? (()=>{
        const spans=workspace.classes.filter(c=>!c.cancelled&&c.weekday===date.getDay()&&(!c.until||key<=c.until))
          .flatMap(c=>windows.map(w=>({
            start:Math.max(timeToMinutes(c.start)??1440,timeToMinutes(w.start)!),
            end:Math.min(timeToMinutes(c.end)??0,timeToMinutes(w.end)!),
          })).filter(v=>v.end>v.start)).sort((a,b)=>a.start-b.start);
        let minutes=0,last=0;for(const span of spans){
          minutes+=Math.max(0,span.end-Math.max(last,span.start));last=Math.max(last,span.end);
        }return minutes;
      })()
      : busyClassMinutesForDay(workspace.classes,date);
    const dueToday=incomplete.filter(h=>validDue(h.dueAt)&&h.dueAt.slice(0,10)===key)
      .reduce((sum,h)=>sum+Math.max(0,h.minutes-bookedHomework(h)),0);
    const bookedToday=(workspace.planSlots||[]).filter(slot=>slot.kind==='homework'
      &&incomplete.some(h=>h.id===slot.itemId)&&slot.date===key&&validPlanSlot(slot))
      .reduce((sum,slot)=>sum+planSlotMinutes(slot),0);
    const backlog=i===0?overdueHomeworkMinutes:0;
    const homeworkMinutes=dueToday+backlog+bookedToday;
    const ranges=windows.map(w=>({start:timeToMinutes(w.start)!,end:timeToMinutes(w.end)!}))
      .sort((a,b)=>a.start-b.start);
    let windowMinutes=0,windowEnd=0;
    for(const span of ranges){windowMinutes+=Math.max(0,span.end-Math.max(windowEnd,span.start));
      windowEnd=Math.max(windowEnd,span.end);}
    const capacity=Math.max(0,Math.min(1440,workspace.dailyAvailableMinutes||0,
      windows.length?windowMinutes:1440));
    result.push({
      date:key,classMinutes,homeworkMinutes,
      overdueHomeworkMinutes:backlog,
      availableMinutes:Math.max(0,capacity-classMinutes-homeworkMinutes),
      overbookedMinutes:Math.max(0,classMinutes+homeworkMinutes-capacity),
      unscheduledHomeworkCount,
    });
  }
  return result;
}

/** 仅计算本地可用时间与冲突，不替用户承诺真实交期。 */
export function calculatePlanRisks(
  workspace: WorkspaceData, fromDate: string = localDate(new Date()),
): PlanRisk[] {
  const open = workspace.commissions
    .filter(c => c.dueDate && c.status === 'active')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.priority - b.priority);
  // A single date forecast shared by all commissions. Previously each row
  // rescanned every lesson and homework item for every day up to its deadline,
  // making the queue increasingly sluggish as commissions accumulated.
  const utcDay=(value:string)=> {
    const parts=value.split('-').map(Number);
    return Date.UTC(parts[0],parts[1]-1,parts[2]);
  };
  const start=new Date(fromDate+'T12:00:00');
  const horizon=Math.max(0,...open.map(c=>{
    const end=new Date(c.dueDate+'T12:00:00');
    return Number.isFinite(end.getTime()) && Number.isFinite(start.getTime())
      ? Math.max(0,Math.min(366,Math.round((utcDay(c.dueDate)-utcDay(fromDate))/86400000)+1))
      : 0;
  }));
  const capacityPrefix=[0];
  for(const day of dailyCapacityForecast(workspace,fromDate,horizon)){
    capacityPrefix.push(capacityPrefix[capacityPrefix.length-1]+day.availableMinutes);
  }
  let required = 0;
  return open.map(c => {
    required += Math.max(0, c.remainingMinutes || 0) + Math.max(0, c.bufferMinutes || 0);
    const end=new Date(c.dueDate+'T12:00:00');
    const days=Number.isFinite(end.getTime()) && Number.isFinite(start.getTime())
      ? Math.max(0,Math.min(366,Math.round((utcDay(c.dueDate)-utcDay(fromDate))/86400000)+1))
      : 0;
    const available=capacityPrefix[days] ?? 0;
    return {
      commissionId: c.id, requiredMinutes: required,
      availableMinutes: available, shortfallMinutes: Math.max(0, required - available),
    };
  });
}

/** 用户开始专注后的聊天是每 5 分钟窗口一次，不可囤积。 */
export function focusChatAllowance(
  session: { mode: 'focus' | 'break'; duration: number; deadline: number;
    pauseRemainingMs?: number; usedChatWindows?: number[] } | null,
  now: number,
): { limit: number; used: number; currentWindow: number; canSend: boolean } {
  if (!session || session.mode !== 'focus') {
    return { limit: 0, used: 0, currentWindow: -1, canSend: true };
  }
  const maxMs = session.duration * 60000;
  const remaining = session.pauseRemainingMs ?? Math.max(0, session.deadline - now);
  const elapsed = Math.max(0, Math.min(maxMs, maxMs - remaining));
  const limit = Math.ceil(session.duration / 5);
  const currentWindow = Math.min(limit - 1, Math.floor(elapsed / 300000));
  const usedWindows = new Set(session.usedChatWindows || []);
  return {
    limit, used: usedWindows.size, currentWindow,
    canSend: session.pauseRemainingMs == null && remaining > 0 && !usedWindows.has(currentWindow),
  };
}
