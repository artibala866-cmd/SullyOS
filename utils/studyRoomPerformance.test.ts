import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {calculatePlanRisks,emptyWorkspace,type Commission,type TimetableClass} from './sullyWorkspace';
import {timetableFormPatch} from '../apps/StudyTimetableEditor';

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8');
const rawCourse:TimetableClass={
  id:'lesson',name:'速写课',weekday:1,start:'09:00',end:'11:00',until:'',
  teacher:'老师',location:'线上',note:'',studyCourseId:'oldPDF',sourceImageRef:'blobref:existing',
};
describe('学习室输入顺手、页面保留和排单性能回归',()=>{
  it('课程表在编辑草稿中不写数据库，保存时只变更本课程字段',()=>{
    const edited={...rawCourse,name:'人体结构',start:'10:00',note:'补课'};
    const patch=timetableFormPatch(rawCourse,edited);
    expect(patch).toEqual({name:'人体结构',start:'10:00',note:'补课'});
    expect(patch).not.toHaveProperty('studyCourseId');
    expect(patch).not.toHaveProperty('sourceImageRef');
    expect(timetableFormPatch(rawCourse,rawCourse)).toEqual({});
  });
  it('具有显式课程保存/取消入口，不为每次输入触发数据库变更',()=>{
    const editor=read('apps/StudyTimetableEditor.tsx');
    const panel=read('apps/WorkspacePanel.tsx');
    expect(editor).toContain('await onSave(patch)');
    expect(editor).toContain('保存修改');
    expect(editor).toContain('取消');
    expect(panel).toContain('StudyTimetableEditor');
    expect(panel).not.toContain('patchClass(c.id,{name:e.target.value})');
    expect(panel).toContain('useMemo(()=>new Map(calculatePlanRisks(data,todayKey)');
  });
  it('非计时视图不进行 500ms 全局重绘；区间切换保留同一个编辑器',()=>{
    const src=read('apps/ScheduleApp.tsx');
    expect(src).toContain("if(tab!=='timer' && !assistantOpen && !exitOpen)return");
    expect(src).not.toContain('setInterval(() => setNow(Date.now()), 500)');
    expect(src).toContain("if(!session || session.pauseRemainingMs!=null || tab==='timer'");
    expect(src).toContain('workspaceVisited && <div');
    expect((src.match(/<WorkspacePanel /g)||[]).length).toBe(1);
    expect(src).toContain("tab === 'study' && (");
    expect(src).toContain('tabScrollOffsets.current[tab]');
  });
  it('100 张稿件共享同一截止日容量，风险仍按累计剩余时间计算',()=>{
    const w=emptyWorkspace();
    w.dailyAvailableMinutes=100;
    const commission=(i:number):Commission=>({
      id:'c'+i,title:'稿'+i,client:'',type:'',brief:'',acceptedAt:'',
      dueDate:i<50?'2026-10-29':'2026-10-30',stage:'草稿',priority:2,
      status:'active',remainingMinutes:5,bufferMinutes:0,plannedDate:'',
      price:'',paid:false,note:'',order:i,
    });
    w.commissions=Array.from({length:100},(_,i)=>commission(i));
    const risks=calculatePlanRisks(w,'2026-10-29');
    expect(risks).toHaveLength(100);
    expect(risks[0]).toMatchObject({requiredMinutes:5,availableMinutes:100,shortfallMinutes:0});
    expect(risks[49]).toMatchObject({requiredMinutes:250,availableMinutes:100,shortfallMinutes:150});
    expect(risks[50]).toMatchObject({requiredMinutes:255,availableMinutes:200,shortfallMinutes:55});
    expect(risks[99]).toMatchObject({requiredMinutes:500,availableMinutes:200,shortfallMinutes:300});
  });
});
