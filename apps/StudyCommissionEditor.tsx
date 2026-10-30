import React,{useState} from 'react';
import {newWorkspaceId,type Commission,type CommissionPhase} from '../utils/sullyWorkspace';

const input='w-full min-w-0 rounded-lg border border-neutral-300 bg-white p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-800';
const fields=['title','client','type','brief','acceptedAt','dueDate','stage','priority',
  'status','remainingMinutes','bufferMinutes','plannedDate','price','paid','note','phases'] as const;
type EditField=typeof fields[number];

/** Only changed fields should be persisted; avoid overwriting unrelated edits. */
export function commissionFormPatch(before:Commission,after:Commission):Partial<Commission>{
  const patch:Partial<Commission>={};
  for(const field of fields){
    if(JSON.stringify(before[field])!==JSON.stringify(after[field])) {
      (patch as unknown as Record<string,unknown>)[field]=after[field];
    }
  }
  return patch;
}

interface Props{
  commission:Commission;
  onSave:(patch:Partial<Commission>)=>Promise<void>;
  onClose:()=>void;
}
export default function StudyCommissionEditor({commission,onSave,onClose}:Props){
  const [draft,setDraft]=useState<Commission>(()=>({...commission}));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const update=<K extends EditField>(key:K,value:Commission[K])=>
    setDraft(prev=>({...prev,[key]:value}));
  const updatePhase=(id:string,patch:Partial<CommissionPhase>)=>
    setDraft(prev=>({...prev,phases:(prev.phases||[]).map(p=>p.id===id?{...p,...patch}:p)}));
  const addPhase=()=>setDraft(prev=>({...prev,phases:[
    ...(prev.phases||[]),{id:newWorkspaceId(),title:'新阶段',remainingMinutes:30,bufferMinutes:0,state:'todo' as const},
  ]}));
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(busy)return;
    if(!draft.title.trim()){setError('请填写稿件名称');return;}
    if(draft.phases?.some(p=>!p.title.trim()||!Number.isInteger(p.remainingMinutes)||p.remainingMinutes<0))
      {setError('请检查阶段名称及剩余分钟');return;}
    const phasesChanged=JSON.stringify(draft.phases)!==JSON.stringify(commission.phases);
    const next=phasesChanged&&draft.phases?.length ? {
      ...draft,remainingMinutes:draft.phases.filter(p=>p.state!=='skipped'&&p.state!=='done')
        .reduce((sum,p)=>sum+p.remainingMinutes,0),
      bufferMinutes:draft.phases.reduce((sum,p)=>sum+(p.state==='skipped'||p.state==='done'?0:p.bufferMinutes),0),
    }:draft;
    const patch=commissionFormPatch(commission,{...next,title:next.title.trim()});
    if(!Object.keys(patch).length){onClose();return;}
    setBusy(true);setError('');
    try{await onSave(patch);onClose();}
    catch(e){setError('保存失败，请检查是否被其他窗口修改：'+String(e));}
    finally{setBusy(false);}
  };
  return <form onSubmit={e=>void save(e)} className="space-y-3 pt-3 text-sm" aria-label={'编辑委托 '+commission.title}>
    <p className="text-sm text-neutral-600">这里先编辑，点击「保存修改」后才写入本地；不会自动通知客户或更改提醒。</p>
    <label className="block text-sm">稿件名称<input className={input} required value={draft.title} onChange={e=>update('title',e.target.value)}/></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-sm">绘画阶段<input className={input} list="sully-stages" value={draft.stage} onChange={e=>update('stage',e.target.value)}/></label>
      <label className="text-sm">状态<select className={input} value={draft.status} onChange={e=>update('status',e.target.value as Commission['status'])}>
        <option value="active">正在绘制</option><option value="waiting">等待客户确认</option>
        <option value="paused">已暂停</option><option value="delivered">交付完成</option>
        <option value="cancelled">已取消</option><option value="archived">归档</option>
      </select></label>
      <label className="text-sm">交稿日期<input className={input} type="date" value={draft.dueDate} onChange={e=>update('dueDate',e.target.value)}/></label>
      <label className="text-sm">计划日期<input className={input} type="date" value={draft.plannedDate} onChange={e=>update('plannedDate',e.target.value)}/></label>
      <label className="text-sm">剩余分钟<input className={input} type="number" min="0" max="100000" value={draft.remainingMinutes} onChange={e=>update('remainingMinutes',Math.max(0,Math.min(100000,Number(e.target.value)||0)))}/></label>
      <label className="text-sm">预留缓冲分钟<input className={input} type="number" min="0" max="100000" value={draft.bufferMinutes} onChange={e=>update('bufferMinutes',Math.max(0,Math.min(100000,Number(e.target.value)||0)))}/></label>
      <label className="text-sm">优先级<select className={input} value={draft.priority} onChange={e=>update('priority',Number(e.target.value))}>
        <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
      </select></label>
      <label className="text-sm">约定价格（仅本地）<input className={input} value={draft.price} onChange={e=>update('price',e.target.value)}/></label>
      <label className="text-sm">接单日期<input className={input} type="date" value={draft.acceptedAt} onChange={e=>update('acceptedAt',e.target.value)}/></label>
      <label className="flex items-center gap-2 text-sm pt-5"><input type="checkbox" checked={draft.paid} onChange={e=>update('paid',e.target.checked)}/>已收款（仅手动）</label>
    </div>
    <fieldset className="space-y-2 border-t border-neutral-200 pt-3">
      <legend className="text-sm">自定义阶段（旧委托可以继续使用单一阶段）</legend>
      {(draft.phases||[]).map(p=><div key={p.id} className="grid grid-cols-2 gap-2">
        <input aria-label="阶段名称" className={input} value={p.title} onChange={ev=>updatePhase(p.id,{title:ev.target.value})}/>
        <select aria-label="阶段状态" className={input} value={p.state}
          onChange={ev=>updatePhase(p.id,{state:ev.target.value as CommissionPhase['state']})}>
          <option value="todo">待开始</option><option value="active">绘制中</option>
          <option value="waiting">等待审核</option><option value="skipped">跳过</option>
          <option value="done">用户已确认结束</option>
        </select>
        <label className="text-xs">剩余分钟<input className={input} type="number" min="0" value={p.remainingMinutes}
          onChange={ev=>updatePhase(p.id,{remainingMinutes:Math.max(0,Number(ev.target.value)||0)})}/></label>
        <label className="text-xs">修改缓冲分钟<input className={input} type="number" min="0" value={p.bufferMinutes}
          onChange={ev=>updatePhase(p.id,{bufferMinutes:Math.max(0,Number(ev.target.value)||0)})}/></label>
        <button type="button" className="text-xs underline" onClick={()=>setDraft(v=>({...v,phases:v.phases?.filter(x=>x.id!==p.id)}))}>移除此阶段</button>
      </div>)}
      <button type="button" className="text-xs underline" onClick={addPhase}>添加阶段</button>
      <p className="text-xs text-neutral-500">阶段状态由你手动确认，计时结束不会自动宣告完成。</p>
    </fieldset>
    <label className="block text-sm">委托人<input className={input} value={draft.client} onChange={e=>update('client',e.target.value)}/></label>
    <label className="block text-sm">稿件类型<input className={input} value={draft.type} onChange={e=>update('type',e.target.value)}/></label>
    <label className="block text-sm">需求与参考<textarea className={input} rows={3} value={draft.brief} onChange={e=>update('brief',e.target.value)}/></label>
    <label className="block text-sm">个人备注<textarea className={input} rows={3} value={draft.note} onChange={e=>update('note',e.target.value)}/></label>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-2">
      <button type="submit" disabled={busy} className="rounded-xl bg-[#383838] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {busy?'正在保存…':'保存修改'}</button>
      <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm">
        取消</button>
    </div>
  </form>;
}
