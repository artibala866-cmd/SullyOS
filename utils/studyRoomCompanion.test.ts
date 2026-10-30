import {describe,it,expect} from 'vitest';
import {emptyWorkspace,type Commission,type ClassHomework} from './sullyWorkspace';
import {buildCompanionOverview,companionMomentText,DEFAULT_STUDY_COACH,normalizeStudyCoachSetting,isStudyCoachQuietTime,nextStudyCoachPrompt,studyCoachBrief,buildStudyRoomReality} from './studyRoomCompanion';
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
 it('督促设置默认关闭，坏存档及非法时间一律退回安全值',()=>{
   expect(normalizeStudyCoachSetting(undefined)).toEqual(DEFAULT_STUDY_COACH);
   expect(normalizeStudyCoachSetting({level:'unexpected',quietStart:'55:99',quietEnd:'hi',paused:'yes'}))
     .toEqual(DEFAULT_STUDY_COACH);
   expect(normalizeStudyCoachSetting({level:'firm',quietEnabled:false,paused:true,quietStart:'09:30',quietEnd:'17:00'}))
     .toEqual({level:'firm',quietEnabled:false,paused:true,quietStart:'09:30',quietEnd:'17:00'});
 });
 it('跨午夜免打扰、整日免打扰与白天窗口准确隔离',()=>{
   const s={...DEFAULT_STUDY_COACH,level:'normal' as const};
   expect(isStudyCoachQuietTime(s,new Date(2026,9,30,23,30))).toBe(true);
   expect(isStudyCoachQuietTime(s,new Date(2026,9,31,7,59))).toBe(true);
   expect(isStudyCoachQuietTime(s,new Date(2026,9,31,8,0))).toBe(false);
   expect(isStudyCoachQuietTime({...s,quietEnabled:false},new Date(2026,9,30,23,30))).toBe(false);
   expect(isStudyCoachQuietTime({...s,quietStart:'10:00',quietEnd:'10:00'},new Date(2026,9,30,12))).toBe(true);
   expect(isStudyCoachQuietTime({...s,quietStart:'10:00',quietEnd:'12:00'},new Date(2026,9,30,11))).toBe(true);
   expect(isStudyCoachQuietTime({...s,quietStart:'10:00',quietEnd:'12:00'},new Date(2026,9,30,13))).toBe(false);
 });
 it('督促只在角色开启、计时未运行、学习室可见且间隔足够时出现',()=>{
   const now=new Date(2026,9,30,14,0);const t=now.getTime();
   const base={charId:'A',setting:{...DEFAULT_STUDY_COACH,level:'normal' as const},session:null,now,
     idleSince:t-16*60000,lastPromptAt:0,isVisible:true,isTimerTab:true};
   expect(nextStudyCoachPrompt(base)).toContain('专注轮次');
   expect(nextStudyCoachPrompt({...base,charId:''})).toBeNull();
   expect(nextStudyCoachPrompt({...base,setting:DEFAULT_STUDY_COACH})).toBeNull();
   expect(nextStudyCoachPrompt({...base,setting:{...base.setting,paused:true}})).toBeNull();
   expect(nextStudyCoachPrompt({...base,session:{mode:'focus'}})).toBeNull();
   expect(nextStudyCoachPrompt({...base,session:{mode:'break'}})).toBeNull();
   expect(nextStudyCoachPrompt({...base,session:{mode:'focus',pauseRemainingMs:1000}})).toBeNull();
   expect(nextStudyCoachPrompt({...base,isVisible:false})).toBeNull();
   expect(nextStudyCoachPrompt({...base,isTimerTab:false})).toBeNull();
   expect(nextStudyCoachPrompt({...base,idleSince:t-5*60000})).toBeNull();
   expect(nextStudyCoachPrompt({...base,lastPromptAt:t-5*60000})).toBeNull();
   expect(nextStudyCoachPrompt({...base,setting:{...base.setting,level:'gentle'}})).toBeNull();
   expect(nextStudyCoachPrompt({...base,setting:{...base.setting,level:'firm'}})).toContain('下一轮');
 });
 it('督促说明只含允许的语气，不包括客户、笔记和私人聊天',()=>{
   expect(studyCoachBrief(DEFAULT_STUDY_COACH)).toBe('');
   expect(studyCoachBrief({...DEFAULT_STUDY_COACH,level:'firm',paused:true})).toBe('');
   expect(studyCoachBrief({...DEFAULT_STUDY_COACH,level:'normal'})).toContain('先询问');
 });

 it('真实课程、排单和专注记录构成同一份连续的学习状态，不能凭计时自动判完成',()=>{
  const workspace=emptyWorkspace();
  workspace.commissions=[{...commission('c1','active'),dueDate:'2026-11-02'}];
  workspace.homework=[homework];
  workspace.classes=[{id:'class1',name:'素描班',weekday:5,start:'09:00',end:'10:00',until:'',
   teacher:'私人老师',location:'私人地点',note:'保密内容'}];
  workspace.focusSettlements=[{sessionId:'done',kind:'commission',itemId:'c1',minutes:25,appliedAt:Date.now()}];
  const logs=[
   {date:'2026-10-30',taskId:'t1',sessionId:'pending',minutes:25},
   {date:'2026-10-30',taskId:'t1',sessionId:'done',minutes:25},
   {date:'2026-10-29',taskId:'t1',sessionId:'past',minutes:30},
  ];
  const tasks=[{id:'t1',source:{kind:'commission' as const,id:'c1'}}];
  const at=new Date(2026,9,30,14);
  const reality=buildStudyRoomReality(workspace,null,'',logs,tasks,at);
  expect(reality.phase).toBe('idle');
  expect(reality.todayFocusMinutes).toBe(50);
  expect(reality.completedRounds).toBe(2);
  expect(reality.unsettledLinkedMinutes).toBe(55);
  expect(reality.activeCommissions).toBe(1);
  expect(reality.pendingHomework).toBe(1);
  expect(reality.todayCourses).toBe(1);
  expect(reality.dueSoonCommissions).toBe(1);
  expect(reality.dueSoonHomework).toBe(1);
  expect(reality.hint).toContain('等待手动核对');
  const inFocus=buildStudyRoomReality(workspace,{mode:'focus'},'绘制',logs,tasks,at);
  expect(inFocus.hint).toContain('绘制');
  const paused=buildStudyRoomReality(workspace,{mode:'focus',pauseRemainingMs:2000},'绘制',logs,tasks,at);
  expect(paused.phase).toBe('paused');
  expect(paused.hint).not.toContain('正在专注');
  expect(buildStudyRoomReality(workspace,{mode:'break'},'',logs,tasks,at).hint).toContain('不打扰');
  expect(JSON.stringify(reality)).not.toContain('私人委托人');
  expect(JSON.stringify(reality)).not.toContain('保密内容');
 });
 it('没有任务记录时不捏造学习进度，已交付或已完成也不伪装为仍待结算',()=>{
  const d=emptyWorkspace();
  d.commissions=[commission('closed','delivered')];
  d.homework=[{...homework,done:true}];
  const actual=buildStudyRoomReality(d,null,'',[
   {date:'2026-10-30',taskId:'t1',sessionId:'x',minutes:25},
  ],[{id:'t1',source:{kind:'commission',id:'closed'}}],new Date(2026,9,30,16));
  expect(actual.todayFocusMinutes).toBe(25);
  expect(actual.unsettledLinkedMinutes).toBe(0);
  expect(actual.activeCommissions).toBe(0);
  expect(actual.pendingHomework).toBe(0);
  expect(actual.hint).toContain('25 分钟');
 });

 it('本机督促根据真实积压的结算、交期和专注纪录变化，而不是始终同一句话',()=>{
   const now=new Date(2026,9,30,14);const t=now.getTime();
   const data=emptyWorkspace();
   data.commissions=[{...commission('draw','active'),dueDate:'2026-11-02'}];
   data.homework=[homework];
   const reality=buildStudyRoomReality(data,null,'',[],[],now);
   const base={charId:'A',setting:{...DEFAULT_STUDY_COACH,level:'normal' as const},
     session:null,now,idleSince:t-20*60000,lastPromptAt:0,isVisible:true,isTimerTab:true,reality};
   expect(nextStudyCoachPrompt(base)).toContain('七天内有 2 项');
   const linked=buildStudyRoomReality(data,null,'',[
    {date:'2026-10-30',taskId:'t',sessionId:'s1',minutes:25},
   ],[{id:'t',source:{kind:'commission',id:'draw'}}],now);
   expect(nextStudyCoachPrompt({...base,reality:linked})).toContain('没有手动核对');
   const soft=nextStudyCoachPrompt({...base,setting:{...base.setting,level:'gentle'},
    idleSince:t-31*60000,reality:linked});
   expect(soft).toContain('需要时再开始');
   expect(soft).not.toContain('你怎么还不');
 });

});
