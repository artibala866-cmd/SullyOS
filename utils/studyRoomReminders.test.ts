import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelStudyReminder, createStudyReminder, permittedReminderText, setWorkspaceChatPermission,
  validateReminderTime, type ReminderRemote,
} from './studyRoomReminders';
import { emptyWorkspace, mutateWorkspace, readWorkspace } from './sullyWorkspace';

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
  beforeEach(() => {
    const w=emptyWorkspace();
    w.commissions=[{id:'client-secret-123',title:'保密委托',client:'客户',type:'',
      brief:'',acceptedAt:'',dueDate:'',stage:'草稿',priority:2,status:'active',
      remainingMinutes:120,bufferMinutes:30,plannedDate:'',price:'',paid:false,note:'',order:1}];
    w.homework=[
      {id:'h1',classId:'class1',title:'作业1',dueAt:'',minutes:60,done:false,note:''},
      {id:'h2',classId:'class1',title:'作业2',dueAt:'',minutes:60,done:false,note:''},
    ];
    stored=w;
  });
  it('统一采用用户本地时间、排除过去和不足两分钟的时间', () => {
    expect(validateReminderTime('2026-11-15T12:00', now)).toContain('2026-11-15T');
    expect(() => validateReminderTime('', now)).toThrow();
    expect(() => validateReminderTime('2026-11-13T12:00', now)).toThrow();
  });
  it('底层拒绝不存在、已完成或已交付的事项，不仅依赖 UI 禁止按钮',async()=>{
    const remote=setupRemote();
    await expect(createStudyReminder('homework','ghost',at,host(),remote,now)).rejects.toThrow('事项不存在');
    const current=await readWorkspace();
    current.homework[0].done=true;
    current.commissions[0].status='delivered';
    stored=current;
    await expect(createStudyReminder('homework','h1',at,host(),remote,now)).rejects.toThrow('已完成');
    await expect(createStudyReminder('commission','client-secret-123',at,host(),remote,now)).rejects.toThrow('已完成');
    expect(remote.schedule).not.toHaveBeenCalled();
    expect(remote.list).not.toHaveBeenCalled();
  });
  it('创建期间作业完成，远端创建一旦返回必须补偿取消，不遗留新提醒',async()=>{
    const remote=setupRemote();
    (remote.schedule as any).mockImplementationOnce(async()=>{
      const current=await readWorkspace();
      current.homework[0].done=true;
      await mutateWorkspace(w=>({...w,homework:w.homework.map(h=>h.id==='h1'?{...h,done:true}:h)}));
      return {uuid:'cloud-uuid',clientTaskId:'client-id',firstSendAt:'2026-11-15T04:00:00.000Z'};
    });
    await expect(createStudyReminder('homework','h1',at,host(),remote,now))
      .rejects.toThrow('已取消刚创建的远端提醒');
    expect(remote.cancel).toHaveBeenCalledWith('cloud-uuid');
    expect((await readWorkspace()).reminders).toEqual([]);
  });
  it('授权在创建过程中撤回，返回 UUID 后应补偿取消，绝不留下幽灵通知',async()=>{
    const remote=setupRemote();
    const base=await readWorkspace();
    base.privateChatPermissions={char1:{study:true,commissions:false}};
    stored=base;
    (remote.schedule as any).mockImplementationOnce(async()=>{
      const revoked=await setWorkspaceChatPermission('char1','study',false,remote);
      expect(revoked.failedCancellations).toBe(1);
      return {uuid:'cloud-uuid',clientTaskId:'client-id',firstSendAt:'2026-11-15T04:00:00.000Z'};
    });
    await expect(createStudyReminder('homework','h1',at,host(),remote,now))
      .rejects.toThrow('已取消刚创建的远端提醒');
    expect(remote.cancel).toHaveBeenCalledWith('cloud-uuid');
    expect((await readWorkspace()).reminders).toHaveLength(0);
    expect((await readWorkspace()).privateChatPermissions.char1.study).toBe(false);
  });
  it('授权撤回且远端取消失败时保留 UUID 和 cancel_failed，供人工重试',async()=>{
    const remote=setupRemote();
    (remote.cancel as any).mockRejectedValueOnce(new Error('offline'));
    (remote.schedule as any).mockImplementationOnce(async()=>{
      await setWorkspaceChatPermission('char1','study',false,remote);
      return {uuid:'cloud-uuid',clientTaskId:'client-id',firstSendAt:'2026-11-15T04:00:00.000Z'};
    });
    await expect(createStudyReminder('homework','h1',at,host(),remote,now))
      .rejects.toThrow('远端取消失败');
    const pending=(await readWorkspace()).reminders[0];
    expect(pending).toMatchObject({status:'cancel_failed',taskUuid:'cloud-uuid'});
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


describe('撤回私聊授权与远端提醒联动', () => {
  beforeEach(() => { stored = null; });
  it('先停用当前 Char 的授权，再仅取消对应分类和角色的任务', async () => {
    const current = emptyWorkspace();
    current.privateChatPermissions={
      char1:{study:true,commissions:true},
      char2:{study:true,commissions:false},
    };
    current.reminders=[
      {id:'h1',kind:'homework',itemId:'a',charId:'char1',fireAt:'2026-11-15T12:00:00Z',taskUuid:'uuid-h1',status:'scheduled'},
      {id:'c1',kind:'commission',itemId:'b',charId:'char1',fireAt:'2026-11-15T12:00:00Z',taskUuid:'uuid-c1',status:'scheduled'},
      {id:'h2',kind:'homework',itemId:'c',charId:'char2',fireAt:'2026-11-15T12:00:00Z',taskUuid:'uuid-h2',status:'scheduled'},
    ];
    stored=current;
    const remote=setupRemote();
    (remote.cancel as any).mockImplementation(async (uuid:string) => {
      const observed=await readWorkspace();
      expect(observed.privateChatPermissions.char1.study).toBe(false);
      return {uuid,alreadyGone:false};
    });
    const result=await setWorkspaceChatPermission('char1','study',false,remote);
    expect(result.failedCancellations).toBe(0);
    expect(remote.cancel).toHaveBeenCalledTimes(1);
    expect(remote.cancel).toHaveBeenCalledWith('uuid-h1');
    expect(result.workspace.privateChatPermissions.char1).toEqual({study:false,commissions:true});
    expect(result.workspace.privateChatPermissions.char2.study).toBe(true);
    expect(result.workspace.reminders.map(r=>r.id)).toEqual(['c1','h2']);
    expect(remote.schedule).not.toHaveBeenCalled();
  });
  it('取消失败不恢复授权，保留 UUID 和失败状态供再次核对', async () => {
    const current=emptyWorkspace();
    current.privateChatPermissions={char1:{study:false,commissions:true}};
    current.reminders=[
      {id:'c1',kind:'commission',itemId:'a',charId:'char1',fireAt:'2026-11-15T12:00:00Z',taskUuid:'cloud-uuid',status:'scheduled'},
      {id:'c2',kind:'commission',itemId:'b',charId:'char1',fireAt:'2026-11-15T12:00:00Z',status:'needs_review'},
    ];
    stored=current;
    const remote=setupRemote();
    (remote.cancel as any).mockRejectedValueOnce(new Error('offline'));
    const result=await setWorkspaceChatPermission('char1','commissions',false,remote);
    expect(result.workspace.privateChatPermissions.char1.commissions).toBe(false);
    expect(result.failedCancellations).toBe(2);
    expect(result.workspace.reminders.map(r=>r.id)).toEqual(['c1','c2']);
    expect(result.workspace.reminders[0].taskUuid).toBe('cloud-uuid');
    expect(result.workspace.reminders[0].status).toBe('cancel_failed');
    expect(remote.cancel).toHaveBeenCalledTimes(1);
  });
});
