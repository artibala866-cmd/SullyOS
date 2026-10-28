import { describe, expect, it } from 'vitest';
import {
  calculatePlanRisks, emptyWorkspace, focusChatAllowance, normalizeWorkspace,
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
});
