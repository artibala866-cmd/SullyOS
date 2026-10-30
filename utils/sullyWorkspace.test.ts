import { describe, expect, it } from 'vitest';
import {
  busyClassMinutesForDay, calculatePlanRisks, planIssues, emptyWorkspace, focusChatAllowance, normalizeWorkspace,
  orderedCommissions, type Commission,
} from './sullyWorkspace';

describe('糯米机每五分钟监督配额', () => {
  const session = (duration: number) => ({
    mode: 'focus' as const, duration, deadline: duration * 60000, usedChatWindows: [] as number[],
  });
  it('5/10/25 分钟分别是 1/2/5 个分窗', () => {
    expect(focusChatAllowance(session(5), 0).limit).toBe(1);
    expect(focusChatAllowance(session(10), 0).limit).toBe(2);
    expect(focusChatAllowance(session(25), 0).limit).toBe(5);
  });
  it('同窗口用过即拦截，下一窗口才可再聊，不会累积', () => {
    const s = session(25);
    s.usedChatWindows = [0];
    expect(focusChatAllowance(s, 10_000).canSend).toBe(false);
    expect(focusChatAllowance(s, 300_001).canSend).toBe(true);
    s.usedChatWindows = [0, 1, 2, 3];
    expect(focusChatAllowance(s, 24 * 60000).currentWindow).toBe(4);
    expect(focusChatAllowance(s, 25 * 60000).canSend).toBe(false);
  });
  it('暂停不能生成新专注对话，休息不受专注限制', () => {
    expect(focusChatAllowance({ ...session(25), pauseRemainingMs: 60000 }, 123).canSend).toBe(false);
    expect(focusChatAllowance({ ...session(5), mode: 'break' }, 123).canSend).toBe(true);
  });
});

describe('排单基础数据', () => {
  const commission = (id: string, dueDate: string, order: number): Commission => ({
    id, dueDate, order, title: id, client: '', type: '', brief: '', acceptedAt: '',
    stage: '草稿', priority: 2, status: 'active', remainingMinutes: 120,
    bufferMinutes: 30, plannedDate: '', price: '', paid: false, note: '',
  });
  it('空数据与历史未知字段安全读取', () => {
    expect(normalizeWorkspace(null)).toEqual(emptyWorkspace());
    expect(normalizeWorkspace({ commissions: [], dailyAvailableMinutes: -10 }).dailyAvailableMinutes).toBe(0);
  });
  it('排单保留人工排序与归档，不误将等待客户计入工作容量', () => {
    const a = commission('a', '2026-11-01', 2);
    const b = commission('b', '2026-10-30', 1);
    const c = { ...commission('c', '2026-10-30', 0), status: 'archived' as const };
    expect(orderedCommissions([a,b,c]).map(x=>x.id)).toEqual(['b','a']);
    const workspace = { ...emptyWorkspace(), commissions: [a, {...b, status: 'waiting' as const}] };
    expect(calculatePlanRisks(workspace, '2026-10-29').length).toBe(1);
  });
  it('两个同时间课程不能重复扣除容量，畸形时间不能产生假欠工', () => {
    const lesson=(id:string,start:string,end:string)=>({
      id,name:id,weekday:4,start,end,until:'',teacher:'',location:'',note:'',
    });
    const date=new Date('2026-10-29T12:00:00');
    expect(busyClassMinutesForDay([
      lesson('a','09:00','11:00'),lesson('b','10:00','12:00'),
      lesson('broken','23:99','25:30'),lesson('reverse','16:00','15:00'),
    ],date)).toBe(180);
    const w=emptyWorkspace();
    w.dailyAvailableMinutes=300;
    w.classes=[lesson('a','09:00','11:00'),lesson('b','10:00','12:00')];
    w.commissions=[{...commission('a','2026-10-29',1),remainingMinutes:150,bufferMinutes:0}];
    expect(calculatePlanRisks(w,'2026-10-29')[0].shortfallMinutes).toBe(30);
  });
  it('超载显示短缺，课程时长会扣减可用时间', () => {
    const data = emptyWorkspace();
    data.dailyAvailableMinutes = 100;
    data.commissions = [{...commission('a','2026-10-29',0),remainingMinutes:200,bufferMinutes:0}];
    expect(calculatePlanRisks(data, '2026-10-29')[0].shortfallMinutes).toBe(100);
    data.classes = [{
      id:'lesson',name:'速写',weekday:4,start:'09:00',end:'10:00',until:'',
      teacher:'',location:'',note:'',
    }];
    expect(calculatePlanRisks(data, '2026-10-29')[0].shortfallMinutes).toBe(160);
  });
  it('具体时段识别课程/画稿/作业重叠和可用时间约束，并兼容旧 stage',()=>{
    const w=emptyWorkspace();
    w.dailyAvailableMinutes=180;
    w.commissions=[{...commission('a','2026-11-05',1),
      phases:[{id:'draft',title:'草稿',remainingMinutes:60,bufferMinutes:10,state:'active'}]}];
    w.homework=[{id:'h1',classId:'class',title:'练习',dueAt:'2026-11-06T18:00',minutes:50,done:false,note:''}];
    w.classes=[{id:'lesson',name:'课程',weekday:4,start:'14:00',end:'15:00',until:'',teacher:'',location:'',note:''}];
    w.availability=[{id:'a',date:'2026-11-05',start:'13:00',end:'18:00'}];
    w.planSlots=[
      {id:'s1',kind:'commission',itemId:'a',phaseId:'draft',date:'2026-11-05',start:'14:30',end:'15:30'},
      {id:'s2',kind:'homework',itemId:'h1',date:'2026-11-05',start:'15:00',end:'16:00'},
    ];
    expect(planIssues(w).some(x=>x.slotId==='s1'&&x.code==='class')).toBe(true);
    expect(planIssues(w).some(x=>x.slotId==='s1'&&x.code==='overlap')).toBe(true);
    w.planSlots[0]={...w.planSlots[0],start:'16:00',end:'17:00'};
    expect(planIssues(w).some(x=>x.slotId==='s1'&&x.code==='overlap')).toBe(false);
    expect(normalizeWorkspace({commissions:[{...commission('b','2026-11-06',2)}]}).commissions[0].stage).toBe('草稿');
    expect(normalizeWorkspace(w).commissions[0].phases?.[0].title).toBe('草稿');
  });

});
