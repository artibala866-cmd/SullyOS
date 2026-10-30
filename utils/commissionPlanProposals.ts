/**
 * 学习室画师排单：模型输出是候选建议，不是命令。
 * Only a fresh user-approved selection can update three explicitly whitelisted fields.
 */
import {
  calculatePlanRisks, localDate, planIssues, validPlanSlot, type WorkspacePlanSlot, type Commission, type WorkspaceData,
} from './sullyWorkspace';

export interface CommissionPlanChange {
  id: string;
  plannedDate?: string;
  remainingMinutes?: number;
  priority?: 1 | 2 | 3;
  slots?: Array<Pick<WorkspacePlanSlot,'date'|'start'|'end'|'phaseId'>>;
  reason: string;
}
export interface CommissionPlanRequest {
  charId: string;
  sourceVersion: string;
  requestedAt: number;
  fromDate: string;
  prompt: string;
  commissions: Array<{ id: string; title: string; dueDate: string }>;
}
export interface CommissionPlanPreview extends CommissionPlanRequest {
  changes: CommissionPlanChange[];
}

/** Relevant planning data only. Payment, contact, notes and remote task IDs excluded. */
export function planSourceVersion(data: WorkspaceData): string {
  return JSON.stringify({
    daily: data.dailyAvailableMinutes,
    commissions: data.commissions.map(c => ({
      id:c.id, status:c.status, stage:c.stage, order:c.order,
      dueDate:c.dueDate, plannedDate:c.plannedDate, priority:c.priority,
      remainingMinutes:c.remainingMinutes, bufferMinutes:c.bufferMinutes,phases:c.phases,
      title:c.title,
    })),
    classes: data.classes.map(c=>({
      id:c.id,weekday:c.weekday,start:c.start,end:c.end,until:c.until,cancelled:c.cancelled,
    })),
    homework: data.homework.map(h=>({
      id:h.id,done:h.done,dueAt:h.dueAt,minutes:h.minutes,
    })),
    availability:data.availability||[],planSlots:data.planSlots||[],
  });
}

export function createCommissionPlanRequest(
  data: WorkspaceData, charId: string,
  fromDate = localDate(new Date()), requestedAt = Date.now(),
): CommissionPlanRequest {
  if (!charId) throw new Error('请先选择 Char');
  const active = data.commissions.filter(c=>c.status==='active').slice(0,10);
  if (!active.length) throw new Error('当前没有进行中的委托可供排单');
  const input = active.map(c=>({
    id:c.id, title:c.title, stage:c.stage, dueDate:c.dueDate,
    plannedDate:c.plannedDate, remainingMinutes:c.remainingMinutes,
    bufferMinutes:c.bufferMinutes, priority:c.priority,
    phases:c.phases?.map(p=>({id:p.id,title:p.title,state:p.state,remainingMinutes:p.remainingMinutes,bufferMinutes:p.bufferMinutes})),
  }));
  const classes=data.classes.filter(c=>!c.cancelled).slice(0,24).map(c=>({
    weekday:c.weekday,start:c.start,end:c.end,until:c.until,
  }));
  const homework=data.homework.filter(h=>!h.done).slice(0,24).map(h=>({
    dueAt:h.dueAt,minutes:h.minutes,
  }));
  const availability=(data.availability||[]).filter(w=>w.date>=fromDate).slice(0,80)
    .map(w=>({date:w.date,start:w.start,end:w.end}));
  const existingSlots=(data.planSlots||[]).filter(w=>w.date>=fromDate).slice(0,100)
    .map(w=>({kind:w.kind,itemId:w.itemId,phaseId:w.phaseId,date:w.date,start:w.start,end:w.end}));
  const prompt = '请根据以下本机排单信息给出建议，不要修改客户承诺的交稿截止日，不要代替用户决定完成状态。'
    + '只输出一个 JSON 对象，不要 Markdown，不要额外说明。'
    + '严格格式：{"changes":[{"id":"原委托id","plannedDate":"YYYY-MM-DD","remainingMinutes":120,"priority":2,"slots":[{"date":"YYYY-MM-DD","start":"14:00","end":"15:00","phaseId":"阶段id或省略"}],"reason":"调整原因"}]}。'
    + '只允许 id、plannedDate、remainingMinutes、priority、slots、reason；可按需要省略修改字段；'
    + 'slots 是此稿完整替换的排程时段，必须落在用户提供的可用时间且不和课程、作业、画稿重叠；'
    + '若未提供可用时间段，不要猜测几点空闲，请只提出优先级或计划日期建议；'
    + 'plannedDate 不能早于今天，也不能晚于该稿 dueDate（如有）；'
    + 'remainingMinutes 必须为 1～10080 的整数；priority 为 1、2、3。'
    + '不要提出更改 dueDate、价格、客户、稿名、状态或付款。最多 10 项；不能确定就返回 {"changes":[]}。'
    + '今天：'+fromDate+'。以下数据仅供本次用户主动请求：'
    + JSON.stringify({
      dailyAvailableMinutes:data.dailyAvailableMinutes,
      commissions:input, classes, homework, availability, existingSlots,
    });
  if (prompt.length > 12000) throw new Error('排单摘要过长，请先缩短稿名或分批排单');
  return {
    charId, fromDate, requestedAt, prompt,
    sourceVersion:planSourceVersion(data),
    commissions:active.map(c=>({id:c.id,title:c.title,dueDate:c.dueDate})),
  };
}

function validDay(value: unknown): value is string {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}
const isObject=(x:unknown):x is Record<string,unknown> =>
  x!==null && typeof x==='object' && !Array.isArray(x);

/**
 * Reject malformed, unknown, duplicate or no-op rows; accept at most 10.
 * No response text is used as an executable instruction.
 */
export function parseCommissionPlanReply(
  reply: string, request: CommissionPlanRequest,
  source: WorkspaceData,
): CommissionPlanPreview {
  if (planSourceVersion(source)!==request.sourceVersion)
    throw new Error('生成建议时的排单已被修改，请重新获取建议');
  if (!reply || reply.length>16000) throw new Error('建议内容为空或过长');
  const trimmed=reply.trim();
  const fenced=trimmed.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  let raw:unknown;
  try { raw=JSON.parse(fenced?fenced[1]:trimmed); }
  catch { throw new Error('Char 未按约定输出 JSON，未生成可应用的建议'); }
  if (!isObject(raw) || !Array.isArray(raw.changes))
    throw new Error('Char 返回的建议缺少 changes 数组');
  if (raw.changes.length>10) throw new Error('建议超过 10 项，拒绝自动截断');
  const allowedIds=new Set(request.commissions.map(c=>c.id));
  const unique=new Set<string>();
  const changes:CommissionPlanChange[]=[];
  for (const row of raw.changes) {
    if (!isObject(row) || typeof row.id!=='string' || !allowedIds.has(row.id) || unique.has(row.id))
      throw new Error('建议包含无效、重复或非本轮委托 ID');
    unique.add(row.id);
    const current=source.commissions.find(c=>c.id===row.id);
    if (!current || current.status!=='active') throw new Error('建议指向的委托不再处于绘制中');
    // Reject any attempt at hidden modifications rather than silently accepting them.
    const accepted=['id','plannedDate','remainingMinutes','priority','slots','reason'];
    if (Object.keys(row).some(k=>!accepted.includes(k)))
      throw new Error('建议含有交期或隐私字段，已拒绝');
    const ch:CommissionPlanChange={id:row.id,reason:typeof row.reason==='string'?row.reason.slice(0,240):''};
    if (row.plannedDate!==undefined) {
      if (!validDay(row.plannedDate) || row.plannedDate<request.fromDate
        || (current.dueDate && row.plannedDate>current.dueDate))
        throw new Error('建议日期无效、早于今天或晚于客户约定交期');
      ch.plannedDate=row.plannedDate;
    }
    if (row.remainingMinutes!==undefined) {
      if (typeof row.remainingMinutes !== 'number' || !Number.isInteger(row.remainingMinutes)
        || row.remainingMinutes<1 || row.remainingMinutes>10080)
        throw new Error('建议的剩余分钟必须在 1～10080 之间');
      ch.remainingMinutes=row.remainingMinutes as number;
    }
    if (row.priority!==undefined) {
      if (![1,2,3].includes(row.priority as number)) throw new Error('建议优先级必须为 1～3');
      ch.priority=row.priority as 1|2|3;
    }
    if(row.slots!==undefined){
      if(!Array.isArray(row.slots)||row.slots.length>30)throw new Error('时段数量无效');
      const known=new Set<string>();
      ch.slots=row.slots.map((raw:unknown)=>{
        if(!isObject(raw)||Object.keys(raw).some(key=>!['date','start','end','phaseId'].includes(key))||
          typeof raw.date!=='string'||typeof raw.start!=='string'||typeof raw.end!=='string')
          throw new Error('时段字段不合法');
        const slot={date:raw.date,start:raw.start,end:raw.end,
          ...(typeof raw.phaseId==='string'?{phaseId:raw.phaseId}:{})};
        if(!validPlanSlot(slot)||slot.date<request.fromDate||(current.dueDate&&slot.date>current.dueDate))
          throw new Error('计划时段无效或超过截止日');
        if(slot.phaseId&&!current.phases?.some(p=>p.id===slot.phaseId&&p.state!=='done'&&p.state!=='skipped'))
          throw new Error('阶段不存在或已结束');
        const key=[slot.date,slot.start,slot.end,slot.phaseId||''].join('|');
        if(known.has(key))throw new Error('同一稿件重复时段');known.add(key);
        return slot;
      });
    }
    if (ch.plannedDate===undefined && ch.remainingMinutes===undefined && ch.priority===undefined && ch.slots===undefined)
      throw new Error('建议没有可修改的字段');
    if ((ch.plannedDate!==undefined && ch.plannedDate!==current.plannedDate)
      || (ch.remainingMinutes!==undefined && ch.remainingMinutes!==current.remainingMinutes)
      || (ch.priority!==undefined && ch.priority!==current.priority)
      || ch.slots!==undefined) changes.push(ch);
  }
  const preview={...request,changes};
  if(changes.some(c=>c.slots!==undefined))projectCommissionPlan(source,preview,changes.map(c=>c.id),request.fromDate);
  return preview;
}

export function isPlanPreviewStale(data:WorkspaceData, preview:CommissionPlanPreview):boolean {
  return planSourceVersion(data)!==preview.sourceVersion;
}

export function projectCommissionPlan(
  data:WorkspaceData, preview:CommissionPlanPreview, selectedIds:readonly string[],
  today=localDate(new Date()),
):WorkspaceData {
  if (today>preview.fromDate)
    throw new Error('建议跨日期已过期，请重新生成，避免应用昨天的计划');
  if (isPlanPreviewStale(data,preview)) throw new Error('排单已变更，旧建议不可应用，请重新生成');
  const selected=new Set(selectedIds);
  if (!selected.size) throw new Error('请先勾选至少一项建议');
  if (selectedIds.length!==selected.size ||
    [...selected].some(id=>!preview.changes.some(c=>c.id===id)))
    throw new Error('包含不存在或重复的建议 ID');
  const changes=new Map(preview.changes.filter(c=>selected.has(c.id)).map(c=>[c.id,c]));
  for(const change of changes.values()){
    if(change.slots?.length && change.slots.some(slot=>!(data.availability||[]).some(w=>w.date===slot.date)))
      throw new Error('用户没有确认当天可用时间，不能应用 Char 猜测的具体时段');
  }
  const next:WorkspaceData={
    ...data,
    commissions:data.commissions.map(c=>{
      const change=changes.get(c.id);
      if (!change) return c;
      // Whitelist is explicit; cannot mutate dueDate, status, client, price etc.
      return {
        ...c,
        ...(change.plannedDate===undefined?{}:{plannedDate:change.plannedDate}),
        ...(change.remainingMinutes===undefined?{}:{remainingMinutes:change.remainingMinutes}),
        ...(change.priority===undefined?{}:{priority:change.priority}),
      } as Commission;
    }),
    planSlots:[
      ...(data.planSlots||[]).filter(s=>s.kind!=='commission'||!changes.get(s.itemId)?.slots),
      ...[...changes].flatMap(([id,ch])=>(ch.slots||[]).map((slot,index)=>({
        id:'char-plan:'+id+':'+index+':'+slot.date+':'+slot.start,
        kind:'commission' as const,itemId:id,...slot,
      }))),
    ],
  };
  const added=new Set([...changes].flatMap(([id,ch])=>(ch.slots||[])
    .map((slot,index)=>'char-plan:'+id+':'+index+':'+slot.date+':'+slot.start)));

  const conflicts=planIssues(next).filter(issue=>added.has(issue.slotId));
  if(conflicts.length)throw new Error('建议时段有冲突：'+conflicts[0].detail);
  return next;
}

export function previewCommissionPlanRisk(
  data:WorkspaceData, preview:CommissionPlanPreview, selectedIds:readonly string[],
) {
  const before=new Map(calculatePlanRisks(data,preview.fromDate).map(r=>[r.commissionId,r]));
  const after=new Map(calculatePlanRisks(
    selectedIds.length?projectCommissionPlan(data,preview,selectedIds):data,
    preview.fromDate,
  ).map(r=>[r.commissionId,r]));
  return [...after].map(([id,r])=>({
    commissionId:id, before:before.get(id)?.shortfallMinutes??0, after:r.shortfallMinutes,
  }));
}
