import {describe,it,expect} from 'vitest';
import {calendarMonthGrid,commissionCalendarEvents,commissionCalendarSummary,validCalendarDate,undatedCommissionItems} from './studyCommissionCalendar';
import type {Commission} from './sullyWorkspace';
const make=(id:string,override:Partial<Commission>={}):Commission=>({
  id,title:'插画 '+id,client:'秘密客户',type:'头像',brief:'敏感需求',acceptedAt:'',
  dueDate:'2026-10-24',plannedDate:'2026-10-06',stage:'线稿',
  priority:2,status:'active',remainingMinutes:80,bufferMinutes:30,
  price:'500',paid:false,note:'私聊备注',order:1,...override,
});
describe('学习室真实委托月历',()=>{
 it('生成正确的周日开头日期，跨月周完整且闰年不漏日',()=>{
   const october=calendarMonthGrid(2026,9);
   expect(october[0].date).toBe('2026-09-27');
   expect(october.at(-1)?.date).toBe('2026-10-31');
   expect(october).toHaveLength(35);
   expect(calendarMonthGrid(2024,1).some(d=>d.date==='2024-02-29')).toBe(true);
   expect(calendarMonthGrid(2026,12)).toEqual([]);
 });
 it('计划日与交稿日分别显示，编辑来源、归档、取消后自动更新',()=>{
   const raw=[make('a'),make('b',{plannedDate:'2026-10-24',dueDate:'2026-10-24',priority:1}),
     make('archived',{status:'archived'}),make('cancelled',{status:'cancelled'}),
     make('bad',{dueDate:'2026-02-31',plannedDate:'Invalid'})];
   const events=commissionCalendarEvents(raw);
   expect(events).toHaveLength(4);
   expect(events.filter(x=>x.date==='2026-10-24').map(x=>x.kind)).toEqual(['deadline','deadline','plan']);
   expect(events[0]).toMatchObject({id:'a',date:'2026-10-06',kind:'plan'});
   expect(JSON.stringify(events)).not.toContain('秘密客户');
   expect(JSON.stringify(events)).not.toContain('敏感需求');
   expect(validCalendarDate('2026-02-31')).toBe(false);
   expect(validCalendarDate('2026-10-24T10:30')).toBe(false);
 });
 it('风险统计只用进行中委托，不把待确认或交付当成欠工',()=>{
   const list=[make('late',{dueDate:'2026-10-21'}),make('soon',{dueDate:'2026-10-30'}),
     make('wait',{status:'waiting',dueDate:'2026-10-30'}),
     make('done',{status:'delivered',dueDate:'2026-10-20'})];
   expect(commissionCalendarSummary(list,'2026-10-29')).toEqual({active:2,finished:1,upcoming:1,late:1});
 });
 it('无日期委托仍能从日历找到；等待中也显示；已归档、已取消、已交付不混入待排期',()=>{
   const list=[
     make('both-missing',{plannedDate:'',dueDate:''}),
     make('waiting',{status:'waiting',plannedDate:'',dueDate:''}),
     make('bad',{plannedDate:'2026-02-31',dueDate:''}),
     make('planned',{dueDate:'',plannedDate:'2026-11-02'}),
     make('deadline',{plannedDate:'',dueDate:'2026-11-04'}),
     make('done',{status:'delivered',plannedDate:'',dueDate:''}),
     make('cancel',{status:'cancelled',plannedDate:'',dueDate:''}),
     make('arch',{status:'archived',plannedDate:'',dueDate:''}),
   ];
   expect(undatedCommissionItems(list).map(c=>c.id)).toEqual(['both-missing','waiting','bad']);
   expect(commissionCalendarEvents(list).map(e=>e.id)).toEqual(['planned','deadline']);
   expect(list[0].title).toBe('插画 both-missing');
 });

});
