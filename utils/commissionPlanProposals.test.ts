import { describe, expect, it } from 'vitest';
import { emptyWorkspace, type Commission, type WorkspaceData } from './sullyWorkspace';
import {
  createCommissionPlanRequest, isPlanPreviewStale, parseCommissionPlanReply,
  previewCommissionPlanRisk, projectCommissionPlan,
} from './commissionPlanProposals';
const commission=(id:string,remainingMinutes=120):Commission=>({
  id,title:id==='a'?'第一张稿':'第二张稿',client:'客户私密名',price:'¥500',
  brief:'客户不公开需求',note:'保密',type:'立绘',acceptedAt:'2026-10-20',
  dueDate:'2026-11-12',plannedDate:'',status:'active',priority:2,
  remainingMinutes,bufferMinutes:30,paid:false,order:id==='a'?1:2,stage:'线稿',
});
const workspace=():WorkspaceData=>{
  const w=emptyWorkspace();
  w.commissions=[commission('a'),commission('b',200)];
  w.dailyAvailableMinutes=100;
  w.classes=[{id:'class',name:'透视',weekday:4,start:'09:00',end:'10:00',
    until:'',teacher:'某老师',location:'私密地址',note:'不发送'}];
  return w;
};
const today='2026-11-10';
const request=(w=workspace())=>createCommissionPlanRequest(w,'charA',today,1);
describe('Char 排单建议必须经过用户逐项确认',()=>{
  it('请求只在点击时构建且不带客户、费用、备注和订单隐私',()=>{
    const req=request();
    expect(req.prompt).toContain('第一张稿');
    for (const word of ['客户私密名','¥500','客户不公开需求','私密地址','某老师','保密'])
      expect(req.prompt).not.toContain(word);
    expect(req.prompt).toContain('"changes"');
  });
  it('有效建议只预览，不修改原始委托；选定一项才变更白名单字段',()=>{
    const w=workspace();const req=request(w);
    const preview=parseCommissionPlanReply(JSON.stringify({changes:[
      {id:'a',plannedDate:'2026-11-11',remainingMinutes:180,priority:1,reason:'提前安排'},
      {id:'b',remainingMinutes:280,reason:'补充工时'},
    ]}),req,w);
    expect(w.commissions[0].remainingMinutes).toBe(120);
    expect(()=>projectCommissionPlan(w,preview,[])).toThrow('勾选');
    const applied=projectCommissionPlan(w,preview,['a']);
    expect(applied.commissions[0]).toMatchObject({
      plannedDate:'2026-11-11',remainingMinutes:180,priority:1,
      dueDate:'2026-11-12',client:'客户私密名',price:'¥500',
      status:'active',note:'保密',
    });
    expect(applied.commissions[1]).toEqual(w.commissions[1]);
    expect(w.commissions[0].plannedDate).toBe('');
    const risks=previewCommissionPlanRisk(w,preview,['a']);
    const second=risks.find(r=>r.commissionId==='b')!;
    expect(second.after).toBeGreaterThan(second.before);
    expect(previewCommissionPlanRisk(w,preview,[]).find(r=>r.commissionId==='b')?.after).toBe(second.before);
  });
  it('拒绝重复ID、陌生ID、修改交期/状态和非日期值',()=>{
    const req=request(),w=workspace();
    for(const changes of [
      [{id:'zzz',plannedDate:'2026-11-11'}],
      [{id:'a',plannedDate:'2026-11-11'},{id:'a',priority:1}],
      [{id:'a',dueDate:'2026-12-12',priority:1}],
      [{id:'a',status:'delivered',priority:1}],
      [{id:'a',plannedDate:'2026-11-13'}],
      [{id:'a',plannedDate:'2026-11-09'}],
      [{id:'a',plannedDate:'2026-02-30'}],
      [{id:'a',remainingMinutes:0}],
      [{id:'a',remainingMinutes:1.5}],
      [{id:'a',priority:0}],
      [{id:'a',reason:'没变'}],
    ]) {
      expect(()=>parseCommissionPlanReply(JSON.stringify({changes}),req,w)).toThrow();
    }
    expect(()=>parseCommissionPlanReply('不是JSON',req,w)).toThrow();
    expect(()=>parseCommissionPlanReply('{"changes":{}}',req,w)).toThrow();
  });
  it('可读 Markdown JSON 代码块；无变化返回空预览，不会写库',()=>{
    const w=workspace(),req=request(w);
    const backtick=String.fromCharCode(96);
    const s=backtick.repeat(3)+'json\n{"changes":[{"id":"b","priority":1,"reason":"先画这张"}]}\n'+backtick.repeat(3);
    expect(parseCommissionPlanReply(s,req,w).changes).toHaveLength(1);
    expect(parseCommissionPlanReply('{"changes":[]}',req,w).changes).toEqual([]);
  });
  it('用户后来调整了另一张稿、课程或总工作时间，旧建议不能覆盖新数据',()=>{
    const w=workspace(),req=request(w);
    const preview=parseCommissionPlanReply(JSON.stringify({
      changes:[{id:'a',remainingMinutes:200,reason:'更准确'}],
    }),req,w);
    for (const modified of [
      {...w,commissions:w.commissions.map(c=>c.id==='b'?{...c,plannedDate:'2026-11-11'}:c)},
      {...w,dailyAvailableMinutes:200},
      {...w,classes:w.classes.map(c=>({...c,start:'10:00'}))},
    ]) {
      expect(isPlanPreviewStale(modified,preview)).toBe(true);
      expect(()=>projectCommissionPlan(modified,preview,['a'])).toThrow('重新生成');
    }
    expect(()=>projectCommissionPlan(w,preview,['a','a'])).toThrow('重复');
  });
  it('方案跨过本地日期后即使委托没改也不能再应用',()=>{
    const w=workspace(),req=request(w);
    const p=parseCommissionPlanReply(
      '{"changes":[{"id":"a","priority":1}]}',req,w);
    expect(()=>projectCommissionPlan(w,p,['a'],'2026-11-11')).toThrow('跨日期已过期');
    expect(projectCommissionPlan(w,p,['a'],'2026-11-10').commissions[0].priority).toBe(1);
  });
  it('请求绑定原 Char；无法把陌生 ID 作为候选更新',()=>{
    const w=workspace(),req=request(w);
    expect(req.charId).toBe('charA');
    expect(req.commissions).toHaveLength(2);
    const preview=parseCommissionPlanReply('{"changes":[{"id":"a","priority":1}]}',req,w);
    expect(preview.charId).toBe('charA');
  });
  it('Char 具体时间段需要用户可用时间、不可冲课，且仅确认后才应用',()=>{
    const w=workspace();w.dailyAvailableMinutes=240;
    w.availability=[{id:'av',date:'2026-11-11',start:'13:00',end:'18:00'}];
    const req=request(w);
    const proposal={changes:[{id:'a',slots:[{date:'2026-11-11',start:'14:00',end:'15:00'}],reason:'下午有空'}]};
    const preview=parseCommissionPlanReply(JSON.stringify(proposal),req,w);
    expect(w.planSlots).toEqual([]);
    const confirmed=projectCommissionPlan(w,preview,['a'],'2026-11-10');
    expect(confirmed.planSlots).toMatchObject([{kind:'commission',itemId:'a',date:'2026-11-11'}]);
    expect(w.planSlots).toEqual([]);
    const missing={...w,availability:[]};
    const absentReq=request(missing);
    expect(()=>parseCommissionPlanReply(JSON.stringify(proposal),absentReq,missing)).toThrow('可用时间');
    const collision={...w,classes:[{...w.classes[0],weekday:3,start:'14:30',end:'15:30'}]};
    const collisionReq=request(collision);
    expect(()=>parseCommissionPlanReply(JSON.stringify(proposal),collisionReq,collision)).toThrow('冲突');
  });

});
