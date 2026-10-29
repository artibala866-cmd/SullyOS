import React,{useState} from 'react';
import type {TimetableClass} from '../utils/sullyWorkspace';

const input='w-full min-w-0 rounded-lg border border-neutral-300 bg-white p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-800';
const editable=['name','weekday','start','end','until','teacher','location','note','cancelled'] as const;
type Field=typeof editable[number];

/** Edit only timetable-owned fields; preserve old PDF links, image refs and IDs. */
export function timetableFormPatch(before:TimetableClass,after:TimetableClass):Partial<TimetableClass>{
  const patch:Partial<TimetableClass>={};
  for(const key of editable){
    if(before[key]!==after[key])(patch as Record<string,unknown>)[key]=after[key];
  }
  return patch;
}
interface Props{
  course:TimetableClass;
  onSave:(patch:Partial<TimetableClass>)=>Promise<void>;
  onClose:()=>void;
}
const weekdays=['周日','周一','周二','周三','周四','周五','周六'];
export default function StudyTimetableEditor({course,onSave,onClose}:Props){
  const [draft,setDraft]=useState<TimetableClass>(()=>({...course}));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const set=<K extends Field>(key:K,value:TimetableClass[K])=>
    setDraft(v=>({...v,[key]:value}));
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(busy)return;
    if(!draft.name.trim()){setError('请填写课程名');return;}
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.end)
      || draft.start>=draft.end){setError('上课结束时间必须晚于开始时间');return;}
    const patch=timetableFormPatch(course,{...draft,name:draft.name.trim()});
    if(!Object.keys(patch).length){onClose();return;}
    setBusy(true);setError('');
    try{await onSave(patch);onClose();}
    catch(e){setError('保存未成功，请检查是否被其他窗口修改：'+String(e));}
    finally{setBusy(false);}
  };
  return <form className="space-y-3 pt-3 text-sm" onSubmit={e=>void submit(e)}>
    <p className="text-sm text-neutral-600">修改先保留在这里，按「保存修改」后才写入课程表；不会更改原 PDF 自习室资料。</p>
    <label className="block text-sm">课程名称<input className={input} required value={draft.name} onChange={e=>set('name',e.target.value)}/></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="block text-sm">上课星期
        <select className={input} value={draft.weekday} onChange={e=>set('weekday',Number(e.target.value))}>
          {weekdays.map((day,i)=><option value={i} key={day}>{day}</option>)}
        </select>
      </label>
      <label className="block text-sm">结束日期<input className={input} type="date" value={draft.until} onChange={e=>set('until',e.target.value)}/></label>
      <label className="block text-sm">开始<input className={input} type="time" value={draft.start} onChange={e=>set('start',e.target.value)}/></label>
      <label className="block text-sm">结束<input className={input} type="time" value={draft.end} onChange={e=>set('end',e.target.value)}/></label>
    </div>
    <label className="block text-sm">老师/班级<input className={input} value={draft.teacher} onChange={e=>set('teacher',e.target.value)}/></label>
    <label className="block text-sm">地点/上课链接<input className={input} value={draft.location} onChange={e=>set('location',e.target.value)}/></label>
    <label className="block text-sm">请假、调课、补课等备注
      <textarea className={input} rows={3} value={draft.note} onChange={e=>set('note',e.target.value)}/>
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={draft.cancelled===true} onChange={e=>set('cancelled',e.target.checked)}/>
      暂停/停课（保留历史）
    </label>
    {error&&<p className="text-sm text-red-700" role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button className="rounded-lg bg-[#383838] text-white px-3 py-2 text-sm disabled:opacity-40" disabled={busy} type="submit">
        {busy?'正在保存…':'保存修改'}
      </button>
      <button type="button" className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" disabled={busy} onClick={onClose}>取消</button>
    </div>
  </form>;
}
