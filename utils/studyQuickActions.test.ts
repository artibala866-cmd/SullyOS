import {describe,expect,it} from 'vitest';
import type {Commission,ClassHomework,TimetableClass} from './sullyWorkspace';
import {nextDrawableCommissions,nextHomework,lessonNameForHomework,deadlineLabel} from './studyQuickActions';
const commission=(id:string,order:number,status:Commission['status']):Commission=>({
  id,title:'画稿'+id,client:'私人客户',type:'',brief:'机密需求',acceptedAt:'',
  dueDate:'2026-11-02',stage:'线稿',priority:2,status,remainingMinutes:60,
  bufferMinutes:20,plannedDate:'',price:'1000',paid:false,note:'隐私备注',order,
});
const hw=(id:string,dueAt:string,done=false):ClassHomework=>({
  id,classId:'class-a',title:'作业'+id,dueAt,done,minutes:40,note:'',
});
describe('学习室快速操作队列',()=>{
  it('画稿遵循用户手动排单顺序且排除等待客户、暂停和已经交付的事项',()=>{
    const list=[commission('waiting',1,'waiting'),commission('later',3,'active'),
      commission('first',2,'active'),commission('delivered',4,'delivered')];
    expect(nextDrawableCommissions(list).map(c=>c.id)).toEqual(['first','later']);
    expect(list[1].id).toBe('later');
    expect(nextDrawableCommissions(list,1).map(c=>c.id)).toEqual(['first']);
    expect(nextDrawableCommissions(list,0)).toEqual([]);
  });
  it('作业按截止日排序，已完成不出现，无日期排最后',()=>{
    const list=[hw('none',''),hw('later','2026-11-20T12:00'),
      hw('completed','2026-10-10T12:00',true),hw('soon','2026-10-30T20:00')];
    expect(nextHomework(list).map(h=>h.id)).toEqual(['soon','later','none']);
    expect(list.map(h=>h.id)).toEqual(['none','later','completed','soon']);
  });
  it('缺失课程仍可开始孤立作业，提示未知归属；日期明确区分今天和逾期',()=>{
    const classes=[{id:'class-a',name:'速写课程'}] as TimetableClass[];
    expect(lessonNameForHomework(classes,'class-a')).toBe('速写课程');
    expect(lessonNameForHomework(classes,'deleted')).toBe('未归属课程');
    expect(deadlineLabel('2026-10-28T18:00','2026-10-29')).toContain('已逾期');
    expect(deadlineLabel('2026-10-29','2026-10-29')).toBe('今天截止');
    expect(deadlineLabel('','2026-10-29')).toBe('未设截止日');
  });
});
