/**
 * Learning room's actionable work queue. Read-only projections; no changes to
 * commitments, homework completion, reminders, or focus history.
 */
import type {Commission,ClassHomework,TimetableClass} from './sullyWorkspace';
import {orderedCommissions} from './sullyWorkspace';

export const nextDrawableCommissions=(items:readonly Commission[],limit=3):Commission[] =>
  orderedCommissions([...items]).filter(c=>c.status==='active')
    .slice(0,Math.max(0,limit));

export const nextHomework=(items:readonly ClassHomework[],limit=4):ClassHomework[] =>
  [...items].filter(h=>!h.done).sort((a,b)=>
    (a.dueAt||'9999-12-31').localeCompare(b.dueAt||'9999-12-31')
    ||a.title.localeCompare(b.title,'zh-Hans'))
    .slice(0,Math.max(0,limit));

export const lessonNameForHomework=(classes:readonly TimetableClass[],classId:string):string=>
  classes.find(c=>c.id===classId)?.name||'未归属课程';

export const deadlineLabel=(value:string,today:string):string=>{
  if(!/^\d{4}-\d{2}-\d{2}/.test(value))return '未设截止日';
  const day=value.slice(0,10);
  if(day<today)return '已逾期 · '+day;
  if(day===today)return '今天截止';
  return day+' 截止';
};
