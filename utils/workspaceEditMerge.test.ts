import {describe,expect,it} from 'vitest';
import {emptyWorkspace,type WorkspaceData} from './sullyWorkspace';
import {mergeWorkspaceLocalEdit} from './workspaceEditMerge';

const make=():WorkspaceData=>{
 const w=emptyWorkspace();
 w.classes=[{id:'lesson',name:'素描',weekday:1,start:'09:00',end:'10:00',until:'',
   teacher:'教师',location:'课室',note:'',studyCourseId:'course-old'}];
 w.homework=[{id:'h1',classId:'lesson',title:'练线稿',dueAt:'',
   minutes:30,done:false,note:''}];
 w.reminders=[{id:'r1',kind:'homework',itemId:'h1',charId:'char-a',
   fireAt:'2026-11-02T09:00:00Z',taskUuid:'uuid-1',status:'scheduled'}];
 w.privateChatPermissions={'char-a':{study:true,commissions:false}};
 return w;
};
describe('本机工作空间字段级合并与并发保存',()=>{
 it('修改作业时保留并发更新的 Char 授权和新提醒 UUID',()=>{
   const base=make();
   const edited={...base,homework:base.homework.map(h=>({...h,done:true}))};
   const latest={...base,privateChatPermissions:{'char-a':{study:false,commissions:false}},
     reminders:[{...base.reminders[0],taskUuid:'remote-new-id',status:'cancel_failed' as const}]};
   const saved=mergeWorkspaceLocalEdit(base,edited,latest);
   expect(saved.homework[0].done).toBe(true);
   expect(saved.privateChatPermissions['char-a'].study).toBe(false);
   expect(saved.reminders[0].taskUuid).toBe('remote-new-id');
   expect(saved.reminders[0].status).toBe('cancel_failed');
 });
 it('更改课程地点不会覆盖另外窗口更新的旧课程链接/其它行',()=>{
   const base=make();
   const edited={...base,classes:base.classes.map(c=>({...c,location:'新教室'}))};
   const another={...base,classes:[
     {...base.classes[0],studyCourseId:'course-new'},
     {...base.classes[0],id:'new',name:'新课'}]};
   const saved=mergeWorkspaceLocalEdit(base,edited,another);
   expect(saved.classes[0]).toMatchObject({location:'新教室',studyCourseId:'course-new'});
   expect(saved.classes.map(c=>c.id)).toEqual(['lesson','new']);
 });
 it('同字段并发修改会拒绝而不是覆盖新值',()=>{
   const base=make();
   const edited={...base,classes:base.classes.map(c=>({...c,name:'我的更名'}))};
   const another={...base,classes:base.classes.map(c=>({...c,name:'其它窗口更名'}))};
   expect(()=>mergeWorkspaceLocalEdit(base,edited,another)).toThrow('已被其他操作修改');
 });
 it('旧快照不能把刚新增的内容删除，删除冲突则拒绝',()=>{
   const base=make();
   const edited={...base,classes:[]};
   const unrelated={...base,classes:[...base.classes,{...base.classes[0],id:'new'}]};
   expect(mergeWorkspaceLocalEdit(base,edited,unrelated).classes.map(c=>c.id)).toEqual(['new']);
   const changed={...base,classes:[{...base.classes[0],start:'13:00'}]};
   expect(()=>mergeWorkspaceLocalEdit(base,edited,changed)).toThrow('不能删除旧快照');
 });
 it('新增资料 ID 不会在多次排队的编辑中漂移',()=>{
   const base=make();
   const h={...base.homework[0],id:'h2',title:'新作业'};
   const one={...base,homework:[...base.homework,h]};
   const two={...one,homework:one.homework.map(v=>v.id==='h2'?{...v,title:'新作业已编辑'}:v)};
   const stored1=mergeWorkspaceLocalEdit(base,one,base);
   const stored2=mergeWorkspaceLocalEdit(one,two,stored1);
   expect(stored2.homework.filter(v=>v.id==='h2')).toMatchObject([{title:'新作业已编辑'}]);
 });
});
