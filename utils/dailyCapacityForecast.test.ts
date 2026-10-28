import {describe,expect,it} from 'vitest';
import {dailyCapacityForecast,calculatePlanRisks,emptyWorkspace} from './sullyWorkspace';
const lesson=(id:string,start:string,end:string)=>({
  id,name:id,weekday:4,start,end,until:'',teacher:'',location:'',note:'',
});
describe('每日时间容量与画稿截止风险共用同一估算',()=>{
 it('重叠课程只扣一次，逾期作业只计入第一天',()=>{
  const w=emptyWorkspace();
  w.dailyAvailableMinutes=300;
  w.classes=[lesson('a','09:00','11:00'),lesson('b','10:00','12:00')];
  w.homework=[
    {id:'overdue',classId:'x',title:'积压',dueAt:'2026-10-28T12:00',
      minutes:60,done:false,note:''},
    {id:'today',classId:'x',title:'今天',dueAt:'2026-10-29T18:00',
      minutes:30,done:false,note:''},
    {id:'undated',classId:'x',title:'无日期',dueAt:'',minutes:100,done:false,note:''},
  ];
  const d=dailyCapacityForecast(w,'2026-10-29',2);
  expect(d[0]).toMatchObject({classMinutes:180,homeworkMinutes:90,
    overdueHomeworkMinutes:60,availableMinutes:30,unscheduledHomeworkCount:1});
  expect(d[1].overdueHomeworkMinutes).toBe(0);
  expect(d[1].availableMinutes).toBe(300);
 });
 it('超量工作以超额分钟展示，不提供虚构的可用负时间',()=>{
  const w=emptyWorkspace();w.dailyAvailableMinutes=60;
  w.classes=[lesson('a','09:00','11:00')];
  const day=dailyCapacityForecast(w,'2026-10-29',1)[0];
  expect(day.availableMinutes).toBe(0);
  expect(day.overbookedMinutes).toBe(60);
  w.commissions=[{id:'c',title:'稿',client:'',type:'',brief:'',acceptedAt:'',
    dueDate:'2026-10-29',stage:'草稿',priority:1,status:'active',
    remainingMinutes:20,bufferMinutes:0,plannedDate:'',price:'',paid:false,note:'',order:1}];
  expect(calculatePlanRisks(w,'2026-10-29')[0].shortfallMinutes).toBe(20);
 });
 it('不完整日期不上日程，最多计算 366 天避免极端备份卡住',()=>{
  const w=emptyWorkspace();
  w.homework=[{id:'x',classId:'',title:'',dueAt:'bad',minutes:100,done:false,note:''}];
  expect(dailyCapacityForecast(w,'2026-10-29',1000)).toHaveLength(366);
  expect(dailyCapacityForecast(w,'not-a-date',7)).toEqual([]);
  expect(dailyCapacityForecast(w,'2026-10-29',1)[0].unscheduledHomeworkCount).toBe(1);
 });
});
