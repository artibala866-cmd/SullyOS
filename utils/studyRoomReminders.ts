/**
 * 学习室的逐项固定提醒。只用已有 AMSG2 schedule/cancel 端点，
 * 不改变私聊提示词，也不将委托/作业详情加入角色任务清单。
 * 如果日后接 AI 动态提醒，必须先完成独立私聊权限审计。
 */
import type {
  APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile,
} from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { ActiveMsgStore } from './activeMsgStore';
import { isAmsg2EnabledForChar } from './amsg2Tasks';
import { resolveAmsgLimits } from './amsgLimits';
import {
  mutateWorkspace, newWorkspaceId, readWorkspace,
  type WorkspaceData, type WorkspaceReminder, type WorkspaceReminderKind,
  type WorkspaceShareCategory, permissionForChar,
} from './sullyWorkspace';

export const STUDY_REMINDER_MIN_LEAD_MS = 2 * 60_000;
export const permittedReminderText = (kind: WorkspaceReminderKind): string =>
  kind === 'commission'
    ? '你在学习室设置的画稿进度检查时间到了。打开学习室看看当前计划；是否完成由你自己决定。'
    : '你在学习室设置的课程作业检查时间到了。打开学习室看看作业进度；是否完成由你自己确认。';

export const remindersFor = (
  data: WorkspaceData, kind: WorkspaceReminderKind, itemId: string,
): WorkspaceReminder[] => data.reminders.filter(r => r.kind === kind && r.itemId === itemId);

/** One per item, reserving a local identity BEFORE the remote side effect. */
export const canCreateReminder = (
  data: WorkspaceData, kind: WorkspaceReminderKind, itemId: string,
): boolean => remindersFor(data, kind, itemId).length === 0;

export interface ReminderHostContext {
  char: CharacterProfile;
  apiConfig: APIConfig;
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
}
type ScheduleRemote = typeof ActiveMsgClient.scheduleCharacterTask;
type CancelRemote = typeof ActiveMsgClient.cancelTask;
type ReadRemote = typeof ActiveMsgClient.listRemoteTasksForChar;
/** Dependency seam also lets tests assert that no paid APIs or network fire unintentionally. */
export interface ReminderRemote {
  schedule: ScheduleRemote;
  cancel: CancelRemote;
  list: ReadRemote;
}
const remoteDefault: ReminderRemote = {
  schedule: (...args) => ActiveMsgClient.scheduleCharacterTask(...args),
  cancel: (...args) => ActiveMsgClient.cancelTask(...args),
  list: (...args) => ActiveMsgClient.listRemoteTasksForChar(...args),
};

export function validateReminderTime(localValue: string, now = Date.now()): string {
  const time = new Date(localValue).getTime();
  if (!Number.isFinite(time) || time < now + STUDY_REMINDER_MIN_LEAD_MS) {
    throw new Error('请至少提前 2 分钟设置未来的提醒时间');
  }
  return new Date(time).toISOString();
}

function changedReminder(
  w: WorkspaceData, id: string, patch: Partial<WorkspaceReminder>,
): WorkspaceData {
  return { ...w, reminders: w.reminders.map(r => r.id === id ? { ...r, ...patch } : r) };
}

export async function createStudyReminder(
  kind: WorkspaceReminderKind,
  itemId: string,
  localValue: string,
  host: ReminderHostContext,
  remote: ReminderRemote = remoteDefault,
  now = Date.now(),
): Promise<WorkspaceData> {
  if (!isAmsg2EnabledForChar(host.char)) throw new Error('请先为选定的 Char 开启主动消息 2.0');
  const fireAt = validateReminderTime(localValue, now);
  const globalConfig = await ActiveMsgStore.getGlobalConfig();
  if (!globalConfig.workerUrl || !globalConfig.userId) throw new Error('请先在设置中配置主动消息 2.0 的 Worker 和用户身份');

  // The remote list is the authoritative count, not just the character's local cache.
  // Fail closed if it cannot be fetched, rather than creating duplicate unknown cloud tasks.
  const remoteTasks = await remote.list(host.char.id);
  const count = remoteTasks.filter(t => !['completed','cancelled','failed'].includes(t.status || '')
    && t.messageSubtype !== 'instant-chat').length;
  if (count >= resolveAmsgLimits(host.char.activeMsg2Config).maxActiveTasks) {
    throw new Error('该 Char 的云端定时任务已达到当前数量上限，请先取消旧任务');
  }
  const current = await readWorkspace();
  if (!canCreateReminder(current, kind, itemId)) {
    throw new Error('此事项已有提醒或待核查任务，请先处理已有记录，避免重复推送');
  }

  // Only generic message text enters the remote system. Never send customer names,
  // prices, requirements, homework notes, or private workspace records.
  const pending: WorkspaceReminder = {
    id: newWorkspaceId(), kind, itemId, charId: host.char.id,
    fireAt, status: 'creating',
  };
  await mutateWorkspace(w => {
    if (!canCreateReminder(w, kind, itemId)) throw new Error('已有提醒，请勿重复创建');
    return { ...w, reminders: [...w.reminders, pending] };
  });

  let confirmed: Awaited<ReturnType<ScheduleRemote>> | undefined;
  try {
    confirmed = await remote.schedule({
      char: host.char,
      config: host.char.activeMsg2Config!,
      task: {
        mode: 'fixed', firstSendTime: fireAt, recurrenceType: 'none',
        userMessage: permittedReminderText(kind), expirePolicy: 'force',
      },
      userProfile: host.userProfile, groups: host.groups,
      realtimeConfig: host.realtimeConfig, apiConfig: host.apiConfig,
    });
    if (!confirmed.uuid || !confirmed.clientTaskId) throw new Error('远端未返回完整任务身份，无法确认提醒');
    try {
      return await mutateWorkspace(w => changedReminder(w, pending.id, {
        taskUuid: confirmed!.uuid, clientTaskId: confirmed!.clientTaskId,
        fireAt: confirmed!.firstSendAt, status: 'scheduled', error: undefined,
      }));
    } catch (error) {
      // Do not leave a confirmed cloud task untraceable if local persistence fails.
      try {
        await remote.cancel(confirmed.uuid);
      } catch (cancelError) {
        await mutateWorkspace(w => changedReminder(w, pending.id, {
          taskUuid: confirmed!.uuid, clientTaskId: confirmed!.clientTaskId,
          status: 'cancel_failed',
          error: '本地存储失败；远端取消也未确认：' + String(cancelError),
        })).catch(() => {});
        throw new Error('远端已创建，但关联保存与取消均未确认；请到 AMSG 2.0 管理页核查');
      }
      await mutateWorkspace(w => ({
        ...w, reminders: w.reminders.filter(r => r.id !== pending.id),
      })).catch(() => {});
      throw new Error('本地关联保存失败，已从远端取消提醒：' + String(error));
    }
  } catch (error) {
    if (!confirmed) {
      // A timed-out write might have succeeded remotely. Never auto-retry blindly.
      await mutateWorkspace(w => changedReminder(w, pending.id, {
        status: 'needs_review', error: '建立状态不明；请在主动消息 2.0 中核对远端任务后再操作。',
      })).catch(() => {});
    }
    throw error;
  }
}

/** Failed cancellation retains the UUID for an explicit retry. */
export async function cancelStudyReminder(
  id: string,
  remote: ReminderRemote = remoteDefault,
): Promise<WorkspaceData> {
  const w = await readWorkspace();
  const reminder = w.reminders.find(r => r.id === id);
  if (!reminder) return w;
  if (!reminder.taskUuid) {
    throw new Error('此提醒没有远端 UUID，无法确认是否已创建；请先检查云端任务清单');
  }
  try {
    await remote.cancel(reminder.taskUuid);
  } catch (error) {
    await mutateWorkspace(current => changedReminder(current, id, {
      status: 'cancel_failed',
      error: '远端取消失败，仍可能触发。' + (error instanceof Error ? error.message : String(error)),
    }));
    throw new Error('远端取消失败，该任务仍可能触发；已保留任务编号，可重试');
  }
  return mutateWorkspace(current => ({
    ...current, reminders: current.reminders.filter(r => r.id !== id),
  }));
}
export async function cancelItemReminders(
  kind: WorkspaceReminderKind,
  itemId: string,
  remote: ReminderRemote = remoteDefault,
): Promise<{ workspace: WorkspaceData; failed: number }> {
  const w = await readWorkspace();
  let failed = 0;
  for (const entry of remindersFor(w, kind, itemId)) {
    try { await cancelStudyReminder(entry.id, remote); } catch { failed += 1; }
  }
  return { workspace: await readWorkspace(), failed };
}


/**
 * Per-Char privacy gate. Revocation persists FIRST (future private-chat requests stop
 * seeing this category), then attempts to cancel only this Char's category reminders.
 * Failed or ambiguous remote tasks keep local UUID/error for explicit retries.
 */
export async function setWorkspaceChatPermission(
  charId: string,
  category: WorkspaceShareCategory,
  enabled: boolean,
  remote: ReminderRemote = remoteDefault,
): Promise<{ workspace: WorkspaceData; failedCancellations: number }> {
  if (!charId || (category !== 'study' && category !== 'commissions')) {
    throw new Error('无效的角色或分享分类');
  }
  const next = await mutateWorkspace(w => ({
    ...w,
    privateChatPermissions: {
      ...w.privateChatPermissions,
      [charId]: { ...permissionForChar(w, charId), [category]: enabled },
    },
  }));
  if (enabled) return {workspace: next, failedCancellations: 0};
  let failedCancellations = 0;
  const kind: WorkspaceReminderKind = category === 'commissions' ? 'commission' : 'homework';
  for (const entry of next.reminders.filter(r => r.kind === kind && r.charId === charId)) {
    try {
      await cancelStudyReminder(entry.id, remote);
    } catch {
      failedCancellations += 1;
    }
  }
  return {workspace: await readWorkspace(), failedCancellations};
}
