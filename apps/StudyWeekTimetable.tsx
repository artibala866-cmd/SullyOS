import React,{useState} from 'react';
import {CalendarDots,MapPin,CaretLeft,CaretRight} from '@phosphor-icons/react';
import type {TimetableClass} from '../utils/sullyWorkspace';
interface Props{classes:readonly TimetableClass[];selectedId:string;onSelect:(id:string)=>void;}
const short=['周日','周一','周二','周三','周四','周五','周六'];
const dayKey=(date:Date)=>date.toLocaleDateString('sv-SE');
export default function StudyWeekTimetable({classes,selectedId,onSelect}:Props){
  const [weekOffset,setWeekOffset]=useState(0);
  const [selectedDay,setSelectedDay]=useState(new Date().getDay());
  const today=new Date(),begin=new Date(today);
  // Local noon avoids nonexistent/repeated midnight during DST changes.
  begin.setHours(12,0,0,0);
  begin.setDate(today.getDate()-today.getDay()+weekOffset*7);
  const dates=Array.from({length:7},(_,i)=>{const date=new Date(begin);date.setDate(begin.getDate()+i);return date;});
  return <section className="rounded-[24px] bg-white p-3 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.025)] space-y-3" aria-label="本周课程时间表">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f2f2f2]"><CalendarDots size={21} weight="light"/></span>
      <div><h3 className="text-[17px] font-semibold">本周课程</h3></div></div>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="上一周" title="上一周"
          className="grid h-11 w-11 place-items-center rounded-full border border-neutral-200 hover:bg-neutral-100"
          onClick={()=>setWeekOffset(x=>Math.max(-520,x-1))}><CaretLeft size={16}/></button>
        <button type="button" aria-label="回到本周" onClick={()=>setWeekOffset(0)}
          className="rounded-full border border-neutral-200 bg-[#fafafa] px-3 py-2 text-xs text-neutral-700">本周</button>
        <button type="button" aria-label="下一周" title="下一周"
          className="grid h-11 w-11 place-items-center rounded-full border border-neutral-200 hover:bg-neutral-100"
          onClick={()=>setWeekOffset(x=>Math.min(520,x+1))}><CaretRight size={16}/></button>
      </div>
    </div>
    <div className="grid grid-cols-7 gap-1" aria-label="选择星期">
      {dates.map((day,i)=>{
        const date=dayKey(day);
        const lessons=classes.filter(c=>!c.cancelled&&c.weekday===day.getDay()&&(!c.until||date<=c.until));
        const active=selectedDay===i;
        const current=dayKey(today)===date;
        return <button type="button" key={date} aria-pressed={active}
          aria-label={date+' '+short[i]} onClick={()=>setSelectedDay(i)}
          className={'flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-[13px] text-xs '+(active?'bg-[#262626] text-white':current?'bg-[#ededed] text-[#222]':'bg-[#f7f7f7] text-neutral-600')}>
          <span className="text-[10px]">{short[i].slice(1)}</span>
          <span className="text-[14px] font-semibold tabular-nums">{day.getDate()}</span>
          {lessons.length>0&&<span className={'h-1 w-1 rounded-full '+(active?'bg-white':'bg-neutral-600')}/>}
        </button>;
      })}
    </div>
    <div className="space-y-1.5" aria-label="当天课程">
      {classes.filter(c=>!c.cancelled&&c.weekday===selectedDay&&(!c.until||dayKey(dates[selectedDay])<=c.until))
        .sort((a,b)=>a.start.localeCompare(b.start))
        .map(c=><button type="button" key={c.id} onClick={()=>onSelect(c.id)}
          aria-label={'查看 '+c.name+' 作业'} aria-pressed={c.id===selectedId}
          className={'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm '+(selectedId===c.id?'bg-[#ebebeb]':'bg-[#f7f7f7]')}>
          <span className="shrink-0 text-xs tabular-nums text-neutral-600">{c.start}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
          {c.location&&<span className="hidden max-w-[100px] truncate text-xs text-neutral-500 sm:flex"><MapPin size={12}/>{c.location}</span>}
        </button>)}
    </div>
  </section>;
}
