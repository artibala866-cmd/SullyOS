import {describe,it,expect} from 'vitest';
import {emptyWorkspace,normalizeWorkspace,workspaceIntegrityWarnings,type WorkspaceData} from './sullyWorkspace';
import {
  replyToCoach,coachSuppressed,proposeCoachSlot,proposeCoachAction,
  decideCoachAction,coachFollowUp,coachConfirmedContext,
} from './studyCoachWorkflow';
const at=(d='2026-11-02T08:00:00')=>new Date(d);
const fixture=():WorkspaceData=>{
  const w=emptyWorkspace();
  w.dailyAvailableMinutes=180;
  w.commissions=[{id:'c',title:'私密画稿',client:'个人客户',price:'600',brief:'保密需求',
    type:'',acceptedAt:'',dueDate:'2026-11-06',stage:'上色',priority:2,status:'active',
    remainingMinutes:80,bufferMinutes:10,plannedDate:'',paid:false,note:'',order:1}];
  w.homework=[{id:'h',classId:'class',title:'练习',dueAt:'2026-11-04T19:00',
    minutes:40,done:false,note:''}];
  w.classes=[{id:'class',name:'课程',weekday:2,start:'13:00',end:'14:00',
    until:'',teacher:'',location:'',note:''}];
  w.availability=[{id:'free',date:'2026-11-03',start:'13:00',end:'15:00'}];
  return w;
};
describe('阶段2真实事件→反馈→候选→确认→跟进',()=>{
  it('未授权可用时间时不编造分钟时段，跨课程只选合法时段',()=>{
    const w=fixture();w.availability=[];
    expect(proposeCoachSlot(w,at())).toBeNull();
    expect(()=>proposeCoachAction(w,'charA','event',at())).toThrow('可用时间');
    w.availability=[{id:'free',date:'2026-11-03',start:'13:00',end:'15:00'}];
    const proposed=proposeCoachSlot(w,at());
    expect(proposed).toMatchObject({kind:'homework',itemId:'h',date:'2026-11-03',start:'14:00',end:'14:25'});
  });
  it('先写待确认、再次确认才进入原日程；Char 不可暗改交期/完成/隐私',()=>{
    const w=fixture(),offered=proposeCoachAction(w,'charA','event-1',at());
    expect(w.coachActions).toEqual([]);
    expect(w.planSlots).toEqual([]);
    const pending=offered.coachActions?.[0]!;
    expect(pending).toMatchObject({charId:'charA',state:'pending',kind:'slot',eventKey:'event-1'});
    expect(offered.planSlots).toEqual([]);
    expect(()=>decideCoachAction(offered,'charB',pending.id,true,at())).toThrow('不属于');
    const confirmed=decideCoachAction(offered,'charA',pending.id,true,at());
    expect(confirmed.planSlots).toHaveLength(1);
    expect(confirmed.coachActions?.[0].state).toBe('applied');
    expect(confirmed.commissions).toEqual(w.commissions);
    expect(confirmed.homework).toEqual(w.homework);
    expect(confirmed.privateChatPermissions).toEqual(w.privateChatPermissions);
    expect(confirmed.reminders).toEqual(w.reminders);
    expect(coachFollowUp(confirmed,'charA',at('2026-11-03T09:00:00'))).toContain('这是计划，不代表已经完成');
    expect(coachFollowUp(confirmed,'charB',at('2026-11-03T09:00:00'))).toBe('');
    expect(coachFollowUp({...confirmed,planSlots:[]},'charA',at('2026-11-03T09:00:00'))).toBe('');
    expect(()=>decideCoachAction(confirmed,'charA',pending.id,true,at())).toThrow('已撤销');
  });
  it('用户拒绝不改变原业务数据；已过期或冲突建议不能被确认',()=>{
    const w=fixture(),offered=proposeCoachAction(w,'charA','real',at());
    const pending=offered.coachActions![0],dismissed=decideCoachAction(offered,'charA',pending.id,false,at());
    expect(dismissed.coachActions?.[0].state).toBe('dismissed');
    expect(dismissed.planSlots).toEqual([]);
    expect(()=>decideCoachAction(offered,'charA',pending.id,true,at('2026-11-04T09:00:00'))).toThrow('过期');
    const collision={...offered,planSlots:[{...pending.slot!,id:'other'}]};
    expect(()=>decideCoachAction(collision,'charA',pending.id,true,at())).toThrow('重叠');
  });
  it('休息、稍后与拒绝按 Char 独立记录并跟随备份读回，不修改私聊授权',()=>{
    const w=fixture();
    const later=replyToCoach(w,'a','event','later',at());
    expect(coachSuppressed(later,'a',at().getTime()+60*60*1000)).toBe(true);
    expect(coachSuppressed(later,'a',at().getTime()+3*60*60*1000)).toBe(false);
    expect(coachSuppressed(later,'b',at().getTime()+1000)).toBe(false);
    const rest=replyToCoach(later,'a','real-rest','rest_today',at());
    expect(coachSuppressed(rest,'a',at('2026-11-02T23:00:00').getTime())).toBe(true);
    expect(coachSuppressed(rest,'a',at('2026-11-03T00:01:00').getTime())).toBe(false);
    const restored=normalizeWorkspace(rest);
    expect(restored.coachActions).toHaveLength(2);
    expect(workspaceIntegrityWarnings(restored)).toEqual([]);
    expect(restored.privateChatPermissions).toEqual(w.privateChatPermissions);
    expect(coachConfirmedContext(restored,'a')).toContain('今天需要休息');
    expect(coachConfirmedContext(restored,'b')).toBe('');
  });
  it('坏记录阻止静默覆盖；旧版没有反馈数据也可读取',()=>{
    const w=fixture();
    expect(normalizeWorkspace({commissions:w.commissions}).coachActions).toEqual([]);
    expect(workspaceIntegrityWarnings({...w,coachActions:'corrupt'}).join(',')).toContain('coachActions');
  });
});
