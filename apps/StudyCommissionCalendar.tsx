import React,{useMemo,useState} from 'react';
import {CalendarBlank,CaretLeft,CaretRight,Flag,PenNib,Clock} from '@phosphor-icons/react';
import type {Commission} from '../utils/sullyWorkspace';
import {calendarMonthGrid,commissionCalendarEvents,commissionCalendarSummary,undatedCommissionItems} from '../utils/studyCommissionCalendar';

interface Props{
  commissions:readonly Commission[];
  onFocus:(id:string,title:string)=>void;
  onEdit:(id:string)=>void;
}
const todayKey=()=>new Date().toLocaleDateString('sv-SE');
const chip='rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700';
export default function StudyCommissionCalendar({commissions,onFocus,onEdit}:Props){
  const [month,setMonth]=useState(()=>todayKey().slice(0,7));
  const [selected,setSelected]=useState(()=>todayKey());
  const [showAll,setShowAll]=useState(false);
  const [y,m]=month.split('-').map(Number);
  const grid=useMemo(()=>calendarMonthGrid(y,m-1),[y,m]);
  const events=useMemo(()=>commissionCalendarEvents(commissions),[commissions]);
  const byDay=useMemo(()=>{
    const map=new Map<string,typeof events>();
    for(const event of events)map.set(event.date,[...(map.get(event.date)||[]),event]);
    return map;
  },[events]);
  const today=todayKey();
  const summary=commissionCalendarSummary(commissions,today);
  const undated=undatedCommissionItems(commissions);
  const selectedEvents=showAll?events.filter(e=>e.date.startsWith(month)):byDay.get(selected)||[];
  const stepMonth=(delta:number)=>{
    const date=new Date(Date.UTC(y,m-1+delta,1));
    const ym=date.toISOString().slice(0,7);
    setMonth(ym);setSelected(ym+'-01');setShowAll(false);
  };
  return <section className="rounded-[24px] bg-white p-3 sm:p-5 shadow-[0_8px_30px_rgba(0,0,0,0.025)] space-y-3" aria-label="委托日历">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f2f2f2]"><CalendarBlank size={21} weight="light"/></span>
        <div><h3 className="text-[17px] font-semibold tracking-tight">委托日程</h3></div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={chip} onClick={()=>{setMonth(today.slice(0,7));setSelected(today);setShowAll(false);}}>今天</button>
        <button type="button" aria-label="上个月" className="grid h-11 w-11 place-items-center rounded-full hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-800" onClick={()=>stepMonth(-1)}><CaretLeft size={17}/></button>
        <span className="min-w-[94px] text-center text-xs font-semibold tabular-nums">{y} / {String(m).padStart(2,'0')}</span>
        <button type="button" aria-label="下个月" className="grid h-11 w-11 place-items-center rounded-full hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-800" onClick={()=>stepMonth(1)}><CaretRight size={17}/></button>
      </div>
    </div>
    <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-neutral-500">
      {['日','一','二','三','四','五','六'].map(day=><span key={day} className="py-1.5">{day}</span>)}
    </div>
    <div className="grid grid-cols-7 gap-x-1 gap-y-1" role="grid" aria-label={month+' 委托日程'}>
      {grid.map(day=>{
        const list=byDay.get(day.date)||[];
        const current=day.date===today;
        const active=day.date===selected&&!showAll;
        return <button key={day.date} type="button" aria-pressed={active}
          onClick={()=>{setSelected(day.date);setShowAll(false);if(!day.inMonth)setMonth(day.date.slice(0,7));}}
          aria-label={day.date+'，'+list.length+' 项日程'}
          className={'min-w-0 min-h-[44px] sm:min-h-[52px] flex flex-col items-center rounded-[14px] px-0.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-800 '+(active?'bg-[#f3f3f3]':day.inMonth?'hover:bg-[#f8f8f8]':'opacity-35')}>
          <span className={'grid h-8 w-8 place-items-center rounded-full text-[13px] tabular-nums '+(active?'bg-[#242424] text-white font-semibold':current?'border border-[#999999] font-semibold text-[#242424]':'text-neutral-700')}>{Number(day.date.slice(-2))}</span>
          <span className="mt-1 flex min-h-[5px] items-center justify-center gap-1" aria-hidden="true">
            {list.slice(0,2).map((e,i)=><span key={e.id+e.kind+i}
              className={'h-1.5 w-1.5 rounded-full '+(e.kind==='deadline'?'bg-[#292929]':'bg-[#b6b6b6]')}/>)}
            {list.length>2&&<span className="text-[9px] text-neutral-500">+</span>}
          </span>
        </button>;
      })}
    </div>
    {undated.length>0&&<div className="rounded-2xl border border-dashed border-neutral-300 bg-[#fafafa] px-4 py-3" aria-label="尚未安排日期的委托">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-neutral-700">{undated.length} 项待安排日期</p>
        <button type="button" onClick={()=>onEdit(undated[0].id)}
          className="shrink-0 rounded-full border border-neutral-300 bg-[#ececec] px-3 py-2 text-xs font-medium text-[#292929]">去安排日期</button>
      </div>
    </div>}
    <div className="flex flex-wrap items-center gap-4 border-t border-neutral-100 pt-3 text-xs text-neutral-600" aria-label="委托数量概览">
      <span>进行中 {summary.active} · 七天内 {summary.upcoming}</span>
      <span className="sm:ml-auto">逾期 {summary.late} · 已交付 {summary.finished}</span>
    </div>
    <div className="border-t border-neutral-100 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-sm">{showAll?'本月全部事项':selected+' · 日程'}</h4>
        <button type="button" className="text-xs text-neutral-600 underline underline-offset-4"
          onClick={()=>setShowAll(v=>!v)}>{showAll?'查看所选日期':'查看本月全部'}</button>
      </div>
      {selectedEvents.length===0?<div className="rounded-2xl bg-[#f8f8f8] p-5 text-center text-xs text-neutral-600">{showAll?'本月暂无已排期委托。':'这一天暂无安排。'}</div>:
        <div className="max-h-64 overflow-y-auto space-y-2">
          {selectedEvents.map(event=>{
            const commission=commissions.find(c=>c.id===event.id);
            return <div key={event.id+'-'+event.kind+'-'+event.date} className="flex items-center gap-3 rounded-2xl border border-neutral-100 bg-[#fcfcfc] p-3">
              <span className="grid shrink-0 h-9 w-9 place-items-center rounded-xl bg-[#ececec]">{event.kind==='deadline'?<Flag size={18}/>:<PenNib size={18}/>}</span>
              <div className="min-w-0 flex-1"><p className="truncate font-medium text-sm">{event.title}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{event.kind==='deadline'?'交稿截止':'计划绘制'} · {event.stage} · {event.date}</p>
              </div>
              {commission?.status==='active'&&<button type="button" title="为此委托专注" aria-label={'专注 '+event.title} onClick={()=>onFocus(event.id,event.title)} className="rounded-full bg-[#383838] px-2.5 py-2 text-xs text-white"><Clock size={15}/></button>}
              <button type="button" onClick={()=>onEdit(event.id)} className={chip}>编辑</button>
            </div>;
          })}
        </div>}
    </div>
  </section>;
}
