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
  return <section className="rounded-[28px] border border-neutral-200 bg-white p-4 sm:p-6 shadow-[0_12px_36px_rgba(0,0,0,0.035)] space-y-4" aria-label="本周课程时间表">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#f2f2f2]"><CalendarDots size={21} weight="light"/></span>
      <div><h3 className="text-[17px] font-semibold">本周课程</h3><p className="text-[11px] tracking-widest text-neutral-400">WEEKLY TIMETABLE</p></div></div>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="上一周" title="上一周"
          className="grid h-9 w-9 place-items-center rounded-full border border-neutral-200 hover:bg-neutral-100"
          onClick={()=>setWeekOffset(x=>Math.max(-520,x-1))}><CaretLeft size={16}/></button>
        <button type="button" aria-label="回到本周" onClick={()=>setWeekOffset(0)}
          className="rounded-full border border-neutral-200 bg-[#fafafa] px-3 py-2 text-[11px] text-neutral-700">本周</button>
        <button type="button" aria-label="下一周" title="下一周"
          className="grid h-9 w-9 place-items-center rounded-full border border-neutral-200 hover:bg-neutral-100"
          onClick={()=>setWeekOffset(x=>Math.min(520,x+1))}><CaretRight size={16}/></button>
      </div>
    </div>
    <p className="text-xs text-neutral-500" aria-live="polite">{dates[0].getFullYear()}年 {dates[0].getMonth()+1}/{dates[0].getDate()} — {dates[6].getMonth()+1}/{dates[6].getDate()}{weekOffset===0?' · 本周':''}</p>
    <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2">
      {dates.map(day=>{
        const key=dayKey(day);
        const lessons=classes.filter(c=>!c.cancelled&&c.weekday===day.getDay()&&(!c.until||key<=c.until))
          .sort((a,b)=>a.start.localeCompare(b.start));
        const current=dayKey(today)===key;
        return <div key={key} className={'min-w-[110px] flex-1 snap-start rounded-2xl border p-2.5 '+(current?'border-neutral-900 bg-[#f8f8f8]':'border-neutral-100 bg-[#fdfdfd]')}>
          <div className="mb-3 text-center">
            <span className={'mx-auto grid h-8 w-8 place-items-center rounded-full font-medium text-xs '+(current?'bg-neutral-900 text-white':'bg-[#f0f0f0]')}>{day.getDate()}</span>
            <p className="mt-1 text-[11px] text-neutral-500">{short[day.getDay()]}</p>
          </div>
          <div className="space-y-2">{lessons.length?lessons.map(c=><button key={c.id} type="button" aria-pressed={c.id===selectedId}
            aria-label={'查看 '+c.name+' 作业'} onClick={()=>onSelect(c.id)}
            className={'w-full rounded-xl border p-2 text-left focus-visible:ring-2 focus-visible:ring-neutral-800 '+(selectedId===c.id?'border-neutral-800 bg-[#e8e8e8]':'border-neutral-100 bg-white hover:border-neutral-400')}>
            <p className="text-[10px] font-medium tabular-nums text-neutral-500">{c.start}–{c.end}</p>
            <p className="mt-1 text-xs font-medium break-words line-clamp-2">{c.name}</p>
            {c.location&&<p className="mt-1 flex items-center gap-0.5 truncate text-[10px] text-neutral-400"><MapPin size={10}/>{c.location}</p>}
          </button>):<div className="grid min-h-[70px] place-items-center text-[11px] text-neutral-300">—</div>}</div>
        </div>;
      })}
    </div>
    <p className="text-[11px] text-neutral-400">左右切换周次，点选课程即可查看作业与笔记；这里只预览每周重复的课程，不修改原资料。</p>
  </section>;
}
