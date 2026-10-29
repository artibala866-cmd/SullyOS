import {describe,it,expect} from 'vitest';
import {emptyWorkspace,type Commission,type ClassHomework} from './sullyWorkspace';
import {buildCompanionOverview,companionMomentText} from './studyRoomCompanion';
import {notesForStudyContext} from './studyRoomFocusNotes';
const commission=(id:string,status:Commission['status']):Commission=>({
 id,title:'画稿'+id,client:'私人委托人',type:'图',brief:'机密需求内容',
 acceptedAt:'2026-10-01',dueDate:'2026-11-09',stage:'上色',priority:1,status,
 remainingMinutes:75,bufferMinutes:30,plannedDate:'2026-11-02',price:'隐私价格',
 paid:false,note:'秘密备注',order:1
});
const homework:ClassHomework={id:'h1',classId:'class1',title:'素描练习',dueAt:'2026-10-31T19:00',
 minutes:50,done:false,note:'不可发送的私人作业答案'};
describe('学习室持续 Char 陪伴：本机状态、单次主动共享、跨模块同一角色',()=>{
 it('专注、暂停、休息、已完成状态均可在本地得到陪伴提示，不自动发 AI',()=>{
  expect(companionMomentText({mode:'focus'},'上色',0)).toContain('上色');
  expect(companionMomentText({mode:'focus',pauseRemainingMs:5000},'上色',0)).toContain('暂停');
  expect(companionMomentText({mode:'break'},'',0)).toContain('休息');
  expect(companionMomentText(null,'',25)).toContain('25 分钟');
  expect(companionMomentText(null,'',0)).toContain('陪');
 });
 it('只有主动打开的每日总览可包含当前任务及任务标题，不包含客户、合同、笔记和普通私聊',()=>{
  const data=emptyWorkspace();
  data.commissions=[commission('draw','active'),commission('wait','waiting')];
  data.homework=[homework];
  data.classes=[{id:'class1',name:'素描班',weekday:5,start:'09:00',end:'12:00',
    until:'',teacher:'隐私老师',location:'私人教室',note:'隐私课程笔记'}];
  const text=buildCompanionOverview(data,{mode:'focus'},'画稿draw',new Date(2026,9,29));
  expect(text).toContain('画稿draw');
  expect(text).toContain('素描练习');
  expect(text).toContain('waitingForClientCount');
  expect(text).not.toContain('私人委托人');
  expect(text).not.toContain('隐私价格');
  expect(text).not.toContain('机密需求内容');
  expect(text).not.toContain('秘密备注');
  expect(text).not.toContain('隐私老师');
  expect(text).not.toContain('私人教室');
  expect(text).not.toContain('不可发送的私人作业答案');
  expect(text.length).toBeLessThanOrEqual(7800);
 });
 it('跨不同工作页面保持同一角色 overview 聊天；与单个作业/画稿对话互不串用',()=>{
  const history=[
    {id:'a1',role:'user' as const,charId:'A',scope:'overview' as const,content:'先做什么'},
    {id:'a2',role:'assistant' as const,charId:'A',scope:'overview' as const,content:'可以先画线稿'},
    {id:'h',role:'user' as const,charId:'A',scope:'study' as const,topicId:'h1',content:'课堂笔记'},
    {id:'c',role:'user' as const,charId:'A',scope:'commission' as const,topicId:'c1',content:'报价'},
    {id:'b',role:'user' as const,charId:'B',scope:'overview' as const,content:'其他角色'},
  ];
  expect(notesForStudyContext(history,'A','overview').map(x=>x.id)).toEqual(['a1','a2']);
  expect(notesForStudyContext(history,'A','study','h1').map(x=>x.id)).toEqual(['h']);
  expect(notesForStudyContext(history,'B','overview').map(x=>x.id)).toEqual(['b']);
 });
});
