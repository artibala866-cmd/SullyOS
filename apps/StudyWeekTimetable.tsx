import React,{useState} from 'react';
import {CalendarDots,MapPin,CaretLeft,CaretRight} from '@phosphor-icons/react';
import type {TimetableClass} from '../utils/sullyWorkspace';
interface Props{classes:readonly TimetableClass[];selectedId:string;onSelect:(id:string)=>void;}
const short=['周日','周一','周二','周三','周四','周五','周六'];
const dayKey=(date:Date)=>date.toLocaleDateString('sv-SE');
export default function StudyWeekTimetable({classes,selectedId,onSelect}:Props){
  const [weekOffset,setWeekOffset]=useState(0);
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
    <p className="text-xs text-neutral-500" aria-live="polite">{dates[0].getFullYear()}年 {dates[0].getMonth()+1}/{dates[0].getDate()} — {dates[6].getMonth()+1}/{dates[6].getDate()}{weekOffset===0?' · 本周':''}</p>
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-3">
      {dates.map(day=>{
        const key=dayKey(day);
        const lessons=classes.filter(c=>!c.cancelled&&c.weekday===day.getDay()&&(!c.until||key<=c.until))
          .sort((a,b)=>a.start.localeCompare(b.start));
        const current=dayKey(today)===key;
        return <div key={key} className={'min-w-[122px] flex-1 snap-start rounded-[22px] px-3 py-4 '+(current?'bg-[#ebebeb]':'bg-[#f7f7f7]')}>
          <div className="mb-4 text-left">
            <span className={'grid h-10 w-10 place-items-center rounded-full font-semibold text-[17px] '+(current?'bg-[#252525] text-white':'bg-white text-[#292929]')}>{day.getDate()}</span>
            <p className="mt-1 text-[11px] text-neutral-500">{short[day.getDay()]}</p>
          </div>
          <div className="space-y-2">{lessons.length?lessons.map(c=><button key={c.id} type="button" aria-pressed={c.id===selectedId}
            aria-label={'查看 '+c.name+' 作业'} onClick={()=>onSelect(c.id)}
            className={'w-full border-l-2 py-1.5 pl-2 text-left focus-visible:ring-2 focus-visible:ring-neutral-800 '+(selectedId===c.id?'border-[#252525] bg-white/65':'border-[#cecece] hover:border-[#666666]')}>
            <p className="text-[11px] font-medium tabular-nums text-neutral-500">{c.start}–{c.end}</p>
            <p className="mt-1 text-[13px] font-semibold break-words line-clamp-2">{c.name}</p>
            {c.location&&<p className="mt-1 flex items-center gap-0.5 truncate text-[11px] text-neutral-500"><MapPin size={10}/>{c.location}</p>}
          </button>):<div className="grid min-h-[50px] place-items-center text-xs text-neutral-500">—</div>}</div>
        </div>;
      })}
    </div>
    <p className="text-xs text-neutral-500">滑动看下一天 · 点击课程查看作业</p>
  </section>;
}
