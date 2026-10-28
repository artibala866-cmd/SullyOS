import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelStudyReminder, createStudyReminder, permittedReminderText,
  validateReminderTime, type ReminderRemote,
} from './studyRoomReminders';
import { readWorkspace } from './sullyWorkspace';

let stored: unknown = null;
vi.mock('./db', () => ({
  DB: {
    getAssetRaw: vi.fn(async () => stored),
    saveAssetRaw: vi.fn(async (_key: string, data: unknown) => { stored = structuredClone(data); }),
  },
}));
vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: { getGlobalConfig: vi.fn(async () => ({workerUrl:'https://worker.example',userId:'test-user'})) },
}));
vi.mock('./activeMsgClient', () => ({
  ActiveMsgClient: { scheduleCharacterTask: vi.fn(), cancelTask: vi.fn(), listRemoteTasksForChar: vi.fn() },
}));

const host = (enabled=true) => ({
  char: {id:'char1',name:'Char',activeMsg2Config:{enabled,tasks:[]}},
  apiConfig: {baseUrl:'',apiKey:'',model:''},
  userProfile: {name:'u'},
  groups: [], realtimeConfig: {},
}) as any;
const setupRemote = () => {
  const schedule = vi.fn().mockResolvedValue({
    uuid:'cloud-uuid',clientTaskId:'client-id',firstSendAt:'2026-11-15T04:00:00.000Z',
  });
  const cancel = vi.fn().mockResolvedValue({uuid:'cloud-uuid',alreadyGone:false});
  const list = vi.fn().mockResolvedValue([]);
  return {schedule,cancel,list} as unknown as ReminderRemote;
};
const at = '2026-11-15T12:00';
const now = new Date('2026-11-14T00:00:00Z').getTime();

describe('学习室 AMSG 固定提醒', () => {
  beforeEach(() => { stored = null; });
  it('统一采用用户本地时间、排除过去和不足两分钟的时间', () => {
    expect(validateReminderTime('2026-11-15T12:00', now)).toContain('2026-11-15T');
    expect(() => validateReminderTime('', now)).toThrow();
    expect(() => validateReminderTime('2026-11-13T12:00', now)).toThrow();
  });
  it('默认不可创建；没有 AMSG 授权时绝不联系远端', async () => {
    const remote=setupRemote();
    await expect(createStudyReminder('homework','h1',at,host(false),remote,now))
      .rejects.toThrow('开启主动消息');
    expect(remote.schedule).not.toHaveBeenCalled();
    expect((await readWorkspace()).reminders).toHaveLength(0);
  });
  it('固定消息不含委托隐私，成功后保存远端真实任务身份并阻止重复', async () => {
    const remote=setupRemote();
    const w = await createStudyReminder('commission','client-secret-123',at,host(),remote,now);
    expect(remote.schedule).toHaveBeenCalledTimes(1);
    const request=(remote.schedule as any).mock.calls[0][0];
    expect(request.task.mode).toBe('fixed');
    expect(request.task.userMessage).toBe(permittedReminderText('commission'));
    expect(JSON.stringify(request.task)).not.toContain('client-secret');
    expect(w.reminders).toMatchObject([{taskUuid:'cloud-uuid',clientTaskId:'client-id',status:'scheduled'}]);
    await expect(createStudyReminder('commission','client-secret-123',at,host(),remote,now))
      .rejects.toThrow('已有提醒');
    expect(remote.schedule).toHaveBeenCalledTimes(1);
  });
  it('远端取消失败必须保留关联并明确报错', async () => {
    const remote=setupRemote();
    const w=await createStudyReminder('homework','h1',at,host(),remote,now);
    (remote.cancel as any).mockRejectedValueOnce(new Error('offline'));
    await expect(cancelStudyReminder(w.reminders[0].id,remote)).rejects.toThrow('仍可能触发');
    const saved=await readWorkspace();
    expect(saved.reminders[0].taskUuid).toBe('cloud-uuid');
    expect(saved.reminders[0].status).toBe('cancel_failed');
    await cancelStudyReminder(w.reminders[0].id,remote);
    expect((await readWorkspace()).reminders).toEqual([]);
  });
  it('请求失败也保留待核查记录，避免重试生成幽灵任务', async () => {
    const remote=setupRemote();
    (remote.schedule as any).mockRejectedValueOnce(new Error('network timeout'));
    await expect(createStudyReminder('homework','h2',at,host(),remote,now)).rejects.toThrow('network timeout');
    expect((await readWorkspace()).reminders[0].status).toBe('needs_review');
    await expect(createStudyReminder('homework','h2',at,host(),remote,now)).rejects.toThrow('已有提醒');
    expect(remote.schedule).toHaveBeenCalledTimes(1);
  });
});
