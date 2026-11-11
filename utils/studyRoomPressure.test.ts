import { describe, expect, it } from 'vitest';
import { DB } from './db';
import {
  WORKSPACE_ASSET_ID, emptyWorkspace, readWorkspace, mutateWorkspace, writeWorkspace,
  calculatePlanRisks, dailyCapacityForecast, planIssues, focusChatAllowance,
  permissionForChar, type WorkspaceData, type Commission, type ClassHomework, type TimetableClass,
} from './sullyWorkspace';
import { pendingFocusProgress, settleFocusProgress } from './studyFocusProgress';
import { exportStudyRoomLocal, restoreStudyRoomLocal } from './studyRoomLocalBackup';
import { nextStudyCoachPrompt, normalizeStudyCoachSetting } from './studyRoomCompanion';

const commission = (index: number): Commission => ({
  id: 'stress-commission-' + index, title: '委托' + index, client: '虚构', type: '插画',
  brief: '仅用于压力测试。'.repeat(8), acceptedAt: '2026-11-01',
  dueDate: '2026-12-' + String(index % 28 + 1).padStart(2, '0'),
  stage: '草稿', priority: 2, status: 'active', remainingMinutes: 60,
  bufferMinutes: 10, plannedDate: '', price: '', paid: false, note: '', order: index,
});
const homework = (index: number): ClassHomework => ({
  id: 'stress-homework-' + index, classId: 'class-' + (index % 140),
  title: '练习' + index, dueAt: '2026-12-' + String(index % 28 + 1).padStart(2, '0') + 'T18:00',
  minutes: 45, done: false, note: '',
});
const klass = (index: number): TimetableClass => ({
  id: 'class-' + index, name: '插画训练' + index, weekday: index % 7, start: '09:00',
  end: '10:00', until: '', teacher: '', location: '', note: '',
});
const bigWorkspace = (): WorkspaceData => ({
  ...emptyWorkspace(),
  commissions: Array.from({ length: 1400 }, (_, i) => commission(i)),
  homework: Array.from({ length: 1800 }, (_, i) => homework(i)),
  classes: Array.from({ length: 140 }, (_, i) => klass(i)),
  notes: Array.from({ length: 350 }, (_, i) => ({
    id: 'note-' + i, classId: 'class-' + (i % 140), body: '学习笔记'.repeat(40), createdAt: 1700000000 + i,
  })),
  planSlots: Array.from({ length: 120 }, (_, i) => ({
    id: 'slot-' + i, kind: 'commission' as const, itemId: 'stress-commission-' + i,
    date: '2026-12-' + String(i % 20 + 1).padStart(2, '0'),
    start: '12:00', end: '12:25',
  })),
  privateChatPermissions: { 'stress-char-off': { study: false, commissions: false } },
});

describe('学习室真实 IndexedDB + 大资料压力测试（不使用用户数据）', () => {
  it('1400 画稿、1800 作业、140 课程和 350 条笔记下，60 次并发修改不能覆盖数据或串权限', async () => {
    const original = await DB.getAssetRaw(WORKSPACE_ASSET_ID);
    try {
      await writeWorkspace(bigWorkspace());
      const actions = await Promise.all(Array.from({ length: 60 }, (_, i) =>
        mutateWorkspace(w => ({
          ...w,
          commissions: w.commissions.map(c => c.id === 'stress-commission-' + i
            ? { ...c, remainingMinutes: 100 + i } : c),
        }))));
      expect(actions).toHaveLength(60);
      const persisted = await readWorkspace();
      expect(persisted.commissions).toHaveLength(1400);
      expect(persisted.homework).toHaveLength(1800);
      expect(persisted.classes).toHaveLength(140);
      expect(persisted.notes).toHaveLength(350);
      for (let i = 0; i < 60; i++)
        expect(persisted.commissions[i].remainingMinutes).toBe(100 + i);
      expect(persisted.privateChatPermissions['stress-char-off']).toEqual({study: false, commissions: false});
      expect(permissionForChar(persisted, 'unknown')).toEqual({study: false, commissions: false});
      expect(persisted.homework[1799].title).toBe('练习1799');
    } finally {
      await DB.saveAssetRaw(WORKSPACE_ASSET_ID, original);
    }
  }, 120000);

  it('10000 专注历史与 400 条关联任务：同一轮只能抵扣一次，不能自动标记完成', () => {
    const data = bigWorkspace();
    const tasks = Array.from({ length: 400 }, (_, i) => ({
      id: 'focus-task-' + i,
      source: { kind: (i % 2 ? 'homework' : 'commission') as 'homework' | 'commission',
        id: (i % 2 ? 'stress-homework-' : 'stress-commission-') + i },
    }));
    const records = Array.from({ length: 10000 }, (_, i) => ({
      taskId: 'focus-task-' + (i % 400), sessionId: 'focus-round-' + i,
      minutes: 25, date: '2026-11-11',
    }));
    const pending = pendingFocusProgress(data, tasks, records, 'commission', 'stress-commission-0');
    expect(pending.sessions).toHaveLength(25);
    const chosen = pending.sessions.slice(0, 2).map(r => r.sessionId!);
    const next = settleFocusProgress(data, tasks, records, 'commission', 'stress-commission-0', chosen, 60);
    expect(next.commissions[0].remainingMinutes).toBe(10);
    expect(next.commissions[0].status).toBe('active');
    expect(next.homework).toBe(data.homework);
    expect(next.privateChatPermissions).toBe(data.privateChatPermissions);
    expect(next.focusSettlements).toHaveLength(2);
    expect(() => settleFocusProgress(next, tasks, records, 'commission', 'stress-commission-0', chosen, 10))
      .toThrow('已经结算');
    expect(() => settleFocusProgress(data, tasks, records, 'homework', 'stress-homework-0', chosen, 45))
      .toThrow();
  }, 60000);

  it('大批排单和课程同时存在时，真实容量预测和冲突检查不应丢失委托', () => {
    const workspace = bigWorkspace();
    const plan = calculatePlanRisks(workspace, '2026-11-11');
    expect(plan).toHaveLength(1400);
    expect(new Set(plan.map(x => x.commissionId)).size).toBe(1400);
    expect(plan.every(x => Number.isFinite(x.shortfallMinutes) && x.shortfallMinutes >= 0)).toBe(true);
    const forecast = dailyCapacityForecast(workspace, '2026-11-11', 35);
    expect(forecast).toHaveLength(35);
    expect(forecast.every(x => Number.isFinite(x.availableMinutes))).toBe(true);
    const issues = planIssues(workspace);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(x => typeof x.slotId === 'string')).toBe(true);
  }, 60000);

  it('暂停、休息、已占用窗口、默认关闭督促状态在上千次检查后不越权', () => {
    const setting = normalizeStudyCoachSetting(undefined);
    expect(setting.level).toBe('off');
    const workspace = bigWorkspace();
    for (let i = 0; i < 1500; i++) {
      const date = new Date(2026, 10, 11, 9, i % 60);
      expect(nextStudyCoachPrompt({
        charId: 'stress-char-off', setting, session: null, now: date,
        idleSince: date.getTime() - 1000000, lastPromptAt: 0,
        lastEventKey: '', promptCountToday: 0, isVisible: true, isTimerTab: true,
      })).toBeNull();
      const focus = {
        mode: 'focus' as const, duration: 25, deadline: 1_500_000,
        usedChatWindows: [0, 1, 2, 3, 4], pauseRemainingMs: 300000,
      };
      expect(focusChatAllowance(focus, i * 1000).canSend).toBe(false);
      expect(permissionForChar(workspace, 'stress-char-off').study).toBe(false);
    }
  }, 30000);

  it('15000 条专注历史本机备份往返完整；坏备份不能部分覆盖现有数据', () => {
    const values = new Map<string,string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const records = Array.from({ length: 15000 }, (_, i) => ({
      taskId: 'stress-task-' + (i % 200), date: '2026-11-11', minutes: 25,
      sessionId: 'stress-session-' + i,
    }));
    store.setItem('sully_pomodoro_v1_records', JSON.stringify(records));
    store.setItem('sully_pomodoro_v1_tasks', JSON.stringify([{id:'stress-task-0',title:'测试任务'}]));
    store.setItem('sully_pomodoro_v1_session', JSON.stringify({ deadline: 1, mode: 'focus' }));
    const snapshot = exportStudyRoomLocal(store);
    const restored = new Map<string,string>();
    const sink = {
      getItem:(key:string)=>restored.get(key)??null,
      setItem:(key:string,value:string)=>{restored.set(key,value);},
      removeItem:(key:string)=>{restored.delete(key);},
    };
    expect(restoreStudyRoomLocal(snapshot, sink)).toBe(true);
    expect(JSON.parse(restored.get('sully_pomodoro_v1_records')!)).toHaveLength(15000);
    expect(restored.has('sully_pomodoro_v1_session')).toBe(false);
    const before = restored.get('sully_pomodoro_v1_records');
    expect(restoreStudyRoomLocal({records:'{broken',tasks:'[]'},sink)).toBe(false);
    expect(restored.get('sully_pomodoro_v1_records')).toBe(before);
  }, 60000);
});
