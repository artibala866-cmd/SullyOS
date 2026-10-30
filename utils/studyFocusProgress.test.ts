import {describe,expect,it} from 'vitest';
import {emptyWorkspace,normalizeWorkspace,workspaceIntegrityWarnings} from './sullyWorkspace';
import {pendingFocusProgress,settleFocusProgress} from './studyFocusProgress';
const fixture=()=>{
  const data=emptyWorkspace();
  data.commissions=[{id:'c1',title:'稿件',client:'私密客户',price:'600',brief:'私密要求',
    type:'',acceptedAt:'',dueDate:'2026-12-01',stage:'上色',priority:2,status:'active' as const,
    remainingMinutes:90,bufferMinutes:30,plannedDate:'',paid:false,note:'',order:1}];
  data.homework=[{id:'h1',classId:'class1',title:'作业',dueAt:'2026-12-01T18:00',
    minutes:50,done:false,note:'笔记保密'}];
  data.reminders=[{id:'r1',kind:'commission' as const,itemId:'c1',charId:'char1',
    fireAt:'2026-12-01T18:00:00Z',taskUuid:'uuid',status:'scheduled' as const}];
  data.privateChatPermissions={char1:{study:false,commissions:false}};
  const tasks=[
    {id:'task-c',source:{kind:'commission' as const,id:'c1'}},
    {id:'task-h',source:{kind:'homework' as const,id:'h1'}},
    {id:'task-other',source:{kind:'commission' as const,id:'unrelated'}},
  ];
  const records=[
    {sessionId:'s1',taskId:'task-c',minutes:25,date:'2026-10-28'},
    {sessionId:'s2',taskId:'task-c',minutes:25,date:'2026-10-29'},
    {sessionId:'h1',taskId:'task-h',minutes:30,date:'2026-10-29'},
    {sessionId:'else',taskId:'task-other',minutes:20,date:'2026-10-29'},
    {taskId:'task-c',minutes:10,date:'2026-10-25'},
  ];
  return {data,tasks,records};
};
describe('学习室·人工结算专注到原委托/作业',()=>{
  it('归属清楚的已完成轮次需用户确认，扣减预计工时但不改完成状态/提醒/私聊授权',()=>{
    const {data,tasks,records}=fixture();
    const pending=pendingFocusProgress(data,tasks,records,'commission','c1');
    expect(pending.minutes).toBe(50);
    expect(pending.legacyMinutes).toBe(10);
    const next=settleFocusProgress(data,tasks,records,'commission','c1',['s1','s2'],90,1000);
    expect(next.commissions[0]).toMatchObject({remainingMinutes:40,status:'active',dueDate:'2026-12-01',
      client:'私密客户',brief:'私密要求'});
    expect(next.homework).toEqual(data.homework);
    expect(next.reminders).toBe(data.reminders);
    expect(next.privateChatPermissions).toBe(data.privateChatPermissions);
    expect(next.focusSettlements).toMatchObject([{sessionId:'s1',itemId:'c1',minutes:25},
      {sessionId:'s2',itemId:'c1',minutes:25}]);
    expect(pendingFocusProgress(next,tasks,records,'commission','c1').minutes).toBe(0);
    expect(()=>settleFocusProgress(next,tasks,records,'commission','c1',['s1'],40)).toThrow('已经结算');
  });
  it('作业计时需手工结算，预估分钟最小为 0，但完成勾选不自动触发',()=>{
    const {data,tasks,records}=fixture();
    const next=settleFocusProgress(data,tasks,records,'homework','h1',['h1'],50);
    expect(next.homework[0]).toMatchObject({minutes:20,done:false,note:'笔记保密'});
    const larger=settleFocusProgress({...data,homework:[{...data.homework[0],minutes:20}]},
      tasks,records,'homework','h1',['h1'],20);
    expect(larger.homework[0]).toMatchObject({minutes:0,done:false});
  });
  it('拒绝重复轮次、他项轮次、未知 ID、旧记录、过期估算及已完成任务',()=>{
    const {data,tasks,records}=fixture();
    for(const ids of [[],['s1','s1'],['else'],['unknown'],['h1']]){
      expect(()=>settleFocusProgress(data,tasks,records,'commission','c1',ids,90)).toThrow();
    }
    expect(()=>settleFocusProgress(data,tasks,records,'commission','c1',['s1'],89)).toThrow('已修改');
    expect(()=>settleFocusProgress(data,tasks,records,'commission','missing',['s1'],90)).toThrow('不存在');
    data.homework[0].done=true;
    expect(()=>settleFocusProgress(data,tasks,records,'homework','h1',['h1'],50)).toThrow('已暂停或完成');
    data.commissions[0].status='waiting';
    expect(()=>settleFocusProgress(data,tasks,records,'commission','c1',['s1'],90)).toThrow('已暂停或完成');
  });
  it('坏记录不能重复结算；旧备份自动取得空 ledger，损坏 ledger 阻止覆盖',()=>{
    const {data,tasks,records}=fixture();
    const invalid=[...records,{sessionId:'s3',taskId:'task-c',minutes:-1},
      {sessionId:'s4',taskId:'task-c',minutes:10000},
      {sessionId:'s1',taskId:'task-c',minutes:25}];
    expect(pendingFocusProgress(data,tasks,invalid,'commission','c1').sessions.map(r=>r.sessionId))
      .toEqual(['s1','s2']);
    expect(normalizeWorkspace({homework:data.homework}).focusSettlements).toEqual([]);
    expect(workspaceIntegrityWarnings({...data,focusSettlements:[
      {sessionId:'s1',kind:'commission',itemId:'c1',minutes:25,appliedAt:1},
      {sessionId:'s1',kind:'commission',itemId:'c1',minutes:25,appliedAt:1},
    ]}).join(' ')).toContain('重复');
  });
  it('人工选择具体阶段结算，但不自动把阶段或委托标记完成',()=>{
    const {data,tasks,records}=fixture();
    data.commissions[0].phases=[{id:'color',title:'上色',state:'active',remainingMinutes:45,bufferMinutes:10}];
    const updated=settleFocusProgress(data,tasks,records,'commission','c1',['s1'],90,1000,'color');
    expect(updated.focusSettlements[0].phaseId).toBe('color');
    expect(updated.commissions[0].phases?.[0]).toMatchObject({remainingMinutes:20,state:'active'});
    expect(updated.commissions[0]).toMatchObject({remainingMinutes:65,status:'active'});
    expect(()=>settleFocusProgress(updated,tasks,records,'commission','c1',['s1'],65,2000,'color')).toThrow();
    expect(()=>settleFocusProgress(data,tasks,records,'commission','c1',['s1','s2'],90,1000,'color')).toThrow('不足');
  });

});
