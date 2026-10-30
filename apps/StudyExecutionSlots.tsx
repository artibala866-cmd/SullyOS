import React,{useMemo,useState} from 'react';
import {newWorkspaceId,planIssues,planSlotMinutes,validPlanSlot,
  type WorkspaceData,type WorkspacePlanSlot,type WorkspaceAvailability,type WorkKind} from '../utils/sullyWorkspace';

const input='w-full min-h-10 rounded-lg border border-neutral-300 px-2 text-sm';
interface Props {
  data:WorkspaceData;
  onChange:(fn:(old:WorkspaceData)=>WorkspaceData)=>Promise<void>;
}
/** A compact editor for existing workspace plans, not a second scheduler. */
export default function StudyExecutionSlots({data,onChange}:Props){
  const [date,setDate]=useState(()=>new Date().toLocaleDateString('sv-SE'));
  const [start,setStart]=useState('14:00'),[end,setEnd]=useState('15:00');
  const [selected,setSelected]=useState(''),[phaseId,setPhaseId]=useState('');
  const [editId,setEditId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [availableStart,setAvailableStart]=useState('09:00'),[availableEnd,setAvailableEnd]=useState('18:00');
  const items=[
    ...data.commissions.filter(c=>c.status==='active').map(c=>({key:'commission:'+c.id,label:'画稿 · '+c.title,kind:'commission' as WorkKind,id:c.id})),
    ...data.homework.filter(h=>!h.done).map(h=>({key:'homework:'+h.id,label:'作业 · '+h.title,kind:'homework' as WorkKind,id:h.id})),
  ];
  const chosen=items.find(i=>i.key===selected)||items[0];
  const phases=chosen?.kind==='commission'
    ?data.commissions.find(c=>c.id===chosen.id)?.phases?.filter(p=>p.state!=='done'&&p.state!=='skipped')||[]
    :[];
  const issues=useMemo(()=>planIssues(data),[data]);
  const issuesById=new Map<string,string[]>();
  for(const issue of issues)issuesById.set(issue.slotId,[...(issuesById.get(issue.slotId)||[]),issue.detail]);
  const saveSlot=async()=>{
    if(!chosen){setError('请先创建委托或作业');return;}
    const slot:WorkspacePlanSlot={id:editId||newWorkspaceId(),kind:chosen.kind,itemId:chosen.id,date,start,end,
      ...(phaseId&&phases.some(p=>p.id===phaseId)?{phaseId}:{})};
    if(!validPlanSlot(slot)){setError('请输入有效日期和起止时间');return;}
    const next={...data,planSlots:[...(data.planSlots||[]).filter(x=>x.id!==slot.id),slot]};
    const errors=planIssues(next).filter(x=>x.slotId===slot.id);
    if(errors.length){setError('时段冲突：'+errors.map(x=>x.detail).join('、'));return;}
    setBusy(true);setError('');
    try{
      await onChange(current=>{
        const updated={...current,planSlots:[...(current.planSlots||[]).filter(x=>x.id!==slot.id),slot]};
        const problems=planIssues(updated).filter(x=>x.slotId===slot.id);
        if(problems.length)throw new Error(problems[0].detail);
        return updated;
      });
      setEditId('');setPhaseId('');
    }catch(e){setError(String(e));}
    finally{setBusy(false);}
  };
  const deleteSlot=async(id:string)=>{
    setBusy(true);try{await onChange(w=>({...w,planSlots:(w.planSlots||[]).filter(s=>s.id!==id)}));}
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const saveAvailability=async()=>{
    const row:WorkspaceAvailability={id:newWorkspaceId(),date,start:availableStart,end:availableEnd};
    if(!validPlanSlot(row)){setError('可用时段日期或时间无效');return;}
    setBusy(true);setError('');
    try{await onChange(w=>({...w,availability:[...(w.availability||[]),row]}));}
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  const deleteAvailability=async(id:string)=>{
    setBusy(true);try{await onChange(w=>({...w,availability:(w.availability||[]).filter(x=>x.id!==id)}));}
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  return <details className="border-t border-neutral-200 pt-3 space-y-3" aria-label="实际执行时段">
    <summary className="min-h-10 cursor-pointer text-sm font-semibold">具体执行时段 · 画稿/作业/课程冲突</summary>
    <p className="text-xs text-neutral-600">计划只预留时间；计时与实际进度单独保存。没有设置明确可用时段时，Char 不应猜测你几点有空。</p>
    <div className="grid grid-cols-3 gap-2">
      <label className="text-xs">日期<input type="date" className={input} value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label className="text-xs">可用起点<input type="time" className={input} value={availableStart} onChange={e=>setAvailableStart(e.target.value)}/></label>
      <label className="text-xs">可用终点<input type="time" className={input} value={availableEnd} onChange={e=>setAvailableEnd(e.target.value)}/></label>
    </div>
    <button type="button" disabled={busy} onClick={()=>void saveAvailability()} className="text-xs underline">添加当天可用时段</button>
    {(data.availability||[]).filter(w=>w.date>=date).slice(0,40).map(w=><div key={w.id} className="flex gap-2 text-xs">
      <span>{w.date} {w.start}–{w.end} 可用</span>
      <button type="button" disabled={busy} className="underline" onClick={()=>void deleteAvailability(w.id)}>删除</button>
    </div>)}
    <div className="grid grid-cols-3 gap-2 border-t border-neutral-200 pt-3">
      <label className="col-span-3 text-xs">当前事项
        <select className={input} value={chosen?.key||''} onChange={e=>{setSelected(e.target.value);setPhaseId('')}}>
          {items.map(i=><option value={i.key} key={i.key}>{i.label}</option>)}
        </select>
      </label>
      {phases.length>0&&<label className="col-span-3 text-xs">绘画阶段
        <select className={input} value={phaseId} onChange={e=>setPhaseId(e.target.value)}>
          <option value="">未指定阶段</option>
          {phases.map(p=><option key={p.id} value={p.id}>{p.title} · 剩余 {p.remainingMinutes} 分</option>)}
        </select>
      </label>}
      <label className="text-xs">计划日期<input type="date" className={input} value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label className="text-xs">开始<input type="time" className={input} value={start} onChange={e=>setStart(e.target.value)}/></label>
      <label className="text-xs">结束<input type="time" className={input} value={end} onChange={e=>setEnd(e.target.value)}/></label>
    </div>
    <button type="button" disabled={busy||!chosen} className="text-xs underline" onClick={()=>void saveSlot()}>
      {editId?'确认调整此时段':'添加可执行计划时段'}
    </button>
    {(data.planSlots||[]).filter(s=>s.date>=date).slice(0,70).map(s=>{
      const item=items.find(i=>i.kind===s.kind&&i.id===s.itemId);
      const phase=s.kind==='commission'
        ?data.commissions.find(c=>c.id===s.itemId)?.phases?.find(p=>p.id===s.phaseId):undefined;
      return <div key={s.id} className="border-t border-neutral-100 pt-2 text-xs">
        <p>{s.date} {s.start}–{s.end} · {item?.label||'已暂停/移除的事项'}{phase?' · '+phase.title:''} · {planSlotMinutes(s)} 分</p>
        {issuesById.get(s.id)?.map((x,i)=><p key={i} role="alert">冲突：{x}</p>)}
        <button type="button" disabled={busy} className="underline mr-3" onClick={()=>{
          setEditId(s.id);setSelected(s.kind+':'+s.itemId);setPhaseId(s.phaseId||'');
          setDate(s.date);setStart(s.start);setEnd(s.end);
        }}>修改</button>
        <button type="button" disabled={busy} className="underline" onClick={()=>void deleteSlot(s.id)}>移除计划</button>
      </div>;
    })}
    {items.map(item=>{
      const remaining=item.kind==='commission'
        ?data.commissions.find(c=>c.id===item.id)?.remainingMinutes||0
        :data.homework.find(h=>h.id===item.id)?.minutes||0;
      const scheduled=(data.planSlots||[]).filter(s=>s.itemId===item.id&&s.kind===item.kind)
        .reduce((n,s)=>n+planSlotMinutes(s),0);
      return <p key={item.key} className="text-xs">{item.label}：剩余估算 {remaining} 分，已排 {scheduled} 分，
        {scheduled<remaining?'尚未排入 '+(remaining-scheduled)+' 分':'排定时间已覆盖当前估算（不代表实际完成）'}</p>;
    })}
    {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  </details>;
}
