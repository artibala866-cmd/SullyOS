import React,{useEffect,useMemo,useState} from 'react';
import {CalendarBlank,BookOpen,NotePencil,ArrowRight} from '@phosphor-icons/react';
import {emptyWorkspace,localDate,readWorkspace,type WorkspaceData} from '../utils/sullyWorkspace';
import {calendarMonthGrid,commissionCalendarEvents,commissionCalendarSummary} from '../utils/studyCommissionCalendar';

interface Props{onCommissions:()=>void;onCourses:()=>void;}
const panel='min-w-0 rounded-[18px] border border-[#e8e8e8] bg-white p-3.5 sm:p-5 shadow-[0_3px_12px_rgba(0,0,0,0.025)]';
const viewAll='flex shrink-0 items-center gap-0.5 text-[11px] text-neutral-500 hover:text-black';
const label='min-w-0 flex items-center gap-1.5 font-semibold text-[13px] text-neutral-900';
export default function StudyHomeOverview({onCommissions,onCourses}:Props){
  const [data,setData]=useState<WorkspaceData>(emptyWorkspace);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selectedDate,setSelectedDate]=useState(()=>localDate(new Date()));
  const today=localDate(new Date());
  // The overview is mounted only on the focus landing page. Returning from
  // either workspace page remounts it, so this stays read-only and current.
  useEffect(()=>{
    let alive=true;
    void readWorkspace().then(value=>{if(alive){setData(value);setError('');}})
      .catch(()=>{if(alive)setError('工作空间暂时无法读取。');})
      .finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  },[]);
  const events=useMemo(()=>commissionCalendarEvents(data.commissions),[data.commissions]);
  const [year,month]=today.slice(0,7).split('-').map(Number);
  const days=useMemo(()=>calendarMonthGrid(year,month-1),[year,month]);
  const selectedEvents=events.filter(x=>x.date===selectedDate);
  const summary=commissionCalendarSummary(data.commissions,today);
  const visibleCourseRows=useMemo(()=>{
    const todayDay=new Date();
    todayDay.setHours(12,0,0,0);
    const result:Array<{id:string;name:string;label:string;start:string;location:string;offset:number}>=[];
    for(let offset=0;offset<7;offset++){
      const day=new Date(todayDay); day.setDate(todayDay.getDate()+offset);
      const key=localDate(day);
      for(const c of data.classes){
        if(c.cancelled||c.weekday!==day.getDay()||(c.until&&c.until<key))continue;
        result.push({id:c.id,name:c.name,label:offset===0?'今天':offset===1?'明天':day.getMonth()+1+'/'+day.getDate(),
          start:c.start,location:c.location,offset});
      }
    }
    return result.sort((a,b)=>a.offset-b.offset||a.start.localeCompare(b.start)).slice(0,2);
  },[data.classes,today]);
  const undone=data.homework.filter(h=>!h.done)
    .sort((a,b)=>(a.dueAt||'9999').localeCompare(b.dueAt||'9999')).slice(0,2);
  return <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2" aria-label="学习室概览">
    <section className={panel+' space-y-3'} aria-label="委托日历速览">
      <div className="flex items-center justify-between gap-2">
        <h2 className={label}><CalendarBlank size={17} weight="light"/> 委托日程</h2>
        <button type="button" className={viewAll} onClick={onCommissions}>完整月历 <ArrowRight size={12}/></button>
      </div>
      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>{year} 年 {month} 月</span>
        <span>{summary.active} 进行中 · {summary.upcoming} 即将截止</span>
      </div>
      <div className="grid grid-cols-7 gap-[3px]" aria-label={year+'-'+month+'月委托预览'}>
        {['日','一','二','三','四','五','六'].map(label=><span key={label} className="text-center text-[10px] text-neutral-400">{label}</span>)}
        {days.map(d=>{
          const items=events.filter(e=>e.date===d.date);
          const active=d.date===selectedDate;
          const current=d.date===today;
          return <button type="button" key={d.date} aria-pressed={active}
            aria-label={d.date+'，'+items.length+'项委托事件'}
            onClick={()=>setSelectedDate(d.date)}
            className={'flex min-h-[28px] flex-col items-center justify-center rounded-lg text-[11px] leading-none '+(!d.inMonth?'text-neutral-300':current?'font-semibold':'text-neutral-700')+' '+(active?'bg-neutral-900 text-white':'hover:bg-[#f2f2f2]')}>
            {Number(d.date.slice(-2))}
            <span className={'mt-[3px] h-[3px] w-[3px] rounded-full '+(items.length?active?'bg-white':'bg-neutral-900':'bg-transparent')}/>
          </button>;
        })}
      </div>
      <div className="flex min-h-9 items-center justify-between gap-2 border-t border-neutral-100 pt-2">
        <p className="min-w-0 truncate text-[11px] text-neutral-600">
          {selectedEvents.length?selectedEvents.slice(0,2).map(e=>(e.kind==='deadline'?'⚑ ':'· ')+e.title).join(' / '):'选中日期暂无排期'}
        </p>
        <button type="button" onClick={onCommissions} className="shrink-0 text-[11px] text-neutral-900 underline underline-offset-2">{selectedEvents.length?'查看事项':'排单'}</button>
      </div>
    </section>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
      <section className={panel+' space-y-2'} aria-label="课程预览">
        <div className="flex items-center justify-between gap-1"><h2 className={label}><BookOpen size={16} weight="light"/> 课程表</h2>
          <button type="button" className={viewAll} aria-label="查看全部课程" onClick={onCourses}><ArrowRight size={14}/></button></div>
        {visibleCourseRows.length?visibleCourseRows.map((c,i)=><button type="button" onClick={onCourses}
          className="flex w-full flex-col gap-0.5 rounded-lg bg-[#f5f5f5] px-2 py-2 text-left" key={c.id+'-'+i}>
          <span className="truncate text-[11px] font-medium text-neutral-900">{c.name}</span>
          <span className="text-[10px] text-neutral-500">{c.label} {c.start}</span>
        </button>):<p className="py-3 text-[11px] text-neutral-400">{loading?'正在读取课程…':'未来七天暂无课程'}</p>}
      </section>
      <section className={panel+' space-y-2'} aria-label="今日作业预览">
        <div className="flex items-center justify-between gap-1"><h2 className={label}><NotePencil size={16} weight="light"/> 待做作业</h2>
          <button type="button" className={viewAll} aria-label="查看全部作业" onClick={onCourses}><ArrowRight size={14}/></button></div>
        {undone.length?undone.map(h=><button type="button" className="flex w-full flex-col gap-0.5 rounded-lg bg-[#f5f5f5] px-2 py-2 text-left" onClick={onCourses} key={h.id}>
          <span className="truncate text-[11px] font-medium text-neutral-900">{h.title}</span>
          <span className="text-[10px] text-neutral-500">{h.dueAt?('截止 '+h.dueAt.slice(5,10)):'尚未设截止日'}</span>
        </button>):<p className="py-3 text-[11px] text-neutral-400">{loading?'正在读取作业…':'目前没有待做作业'}</p>}
      </section>
    </div>
    {error&&<p role="alert" className="col-span-full text-xs text-neutral-700">{error} 请进入排单或课程表检查。</p>}
  </div>;
}
