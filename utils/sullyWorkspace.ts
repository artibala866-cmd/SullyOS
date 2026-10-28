/**
 * 糯米机本地数据。独立于旧 StudyCourse / sully_pomodoro_v1。
 * 存在现有 assets IndexedDB store，随完整备份导出，不读取普通私聊。
 */
import { DB } from './db';

export const WORKSPACE_ASSET_ID = 'sully_workspace_v1';
export const DEFAULT_STAGES = ['待确认', '排队', '草稿', '线稿', '上色', '细化', '待审核', '交付完成'] as const;
export type WorkKind = 'commission' | 'homework';
export type WorkStatus = 'active' | 'waiting' | 'paused' | 'delivered' | 'cancelled' | 'archived';

export interface Commission {
  id: string;
  title: string;
  client: string;
  type: string;
  brief: string;
  acceptedAt: string;
  dueDate: string;
  stage: string;
  priority: number;
  status: WorkStatus;
  remainingMinutes: number;
  bufferMinutes: number;
  plannedDate: string;
  price: string;
  paid: boolean;
  note: string;
  order: number;
}

export interface TimetableClass {
  id: string;
  name: string;
  weekday: number; // 0=周日；每周重复，独立于原 StudyCourse
  start: string;
  end: string;
  until: string;
  teacher: string;
  location: string;
  note: string;
  sourceImageRef?: string;
  studyCourseId?: string;
  cancelled?: boolean;
}
export interface ClassHomework {
  id: string;
  classId: string;
  title: string;
  dueAt: string;
  minutes: number;
  done: boolean;
  note: string;
}
export interface ClassNote {
  id: string;
  classId: string;
  body: string;
  createdAt: number;
}
export type WorkspaceReminderKind = 'commission' | 'homework';
export type WorkspaceReminderStatus = 'creating' | 'scheduled' | 'cancel_failed' | 'needs_review';
/** Separate local link: never injected into normal private-chat context. */
export interface WorkspaceReminder {
  id: string;
  kind: WorkspaceReminderKind;
  itemId: string;
  charId: string;
  fireAt: string; // absolute ISO from the user's local datetime picker
  taskUuid?: string;
  clientTaskId?: string;
  status: WorkspaceReminderStatus;
  error?: string;
}
export interface WorkspaceData {
  reminders: WorkspaceReminder[];
  commissions: Commission[];
  classes: TimetableClass[];
  homework: ClassHomework[];
  notes: ClassNote[];
  dailyAvailableMinutes: number; // 绘画与学习共同的日可用预算
}
export const emptyWorkspace = (): WorkspaceData => ({
  commissions: [], classes: [], homework: [], notes: [], reminders: [], dailyAvailableMinutes: 240,
});
export const localDate = (date: Date): string =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
export const newWorkspaceId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);

export function normalizeWorkspace(raw: unknown): WorkspaceData {
  const fallback = emptyWorkspace();
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Partial<WorkspaceData>;
  return {
    commissions: Array.isArray(obj.commissions) ? obj.commissions : [],
    classes: Array.isArray(obj.classes) ? obj.classes : [],
    homework: Array.isArray(obj.homework) ? obj.homework : [],
    notes: Array.isArray(obj.notes) ? obj.notes : [],
    reminders: Array.isArray(obj.reminders) ? obj.reminders : [],
    dailyAvailableMinutes: Number.isFinite(obj.dailyAvailableMinutes)
      ? Math.max(0, Math.min(1440, Number(obj.dailyAvailableMinutes))) : fallback.dailyAvailableMinutes,
  };
}
// Shared across panel mounts: switching tabs must not read before a pending save lands.
let pendingSave: Promise<void> = Promise.resolve();
export async function readWorkspace(): Promise<WorkspaceData> {
  await pendingSave.catch(() => {});
  return normalizeWorkspace(await DB.getAssetRaw(WORKSPACE_ASSET_ID));
}
export function writeWorkspace(workspace: WorkspaceData): Promise<void> {
  pendingSave = pendingSave.catch(() => {}).then(() => DB.saveAssetRaw(WORKSPACE_ASSET_ID, workspace));
  return pendingSave;
}
/** Serial read-modify-write with other workspace writes, for confirmed remote task links. */
export async function mutateWorkspace(
  update: (prev: WorkspaceData) => WorkspaceData,
): Promise<WorkspaceData> {
  let saved: WorkspaceData | undefined;
  const transaction = pendingSave.catch(() => {}).then(async () => {
    const current = normalizeWorkspace(await DB.getAssetRaw(WORKSPACE_ASSET_ID));
    saved = update(current);
    await DB.saveAssetRaw(WORKSPACE_ASSET_ID, saved);
  });
  pendingSave = transaction;
  await transaction;
  return saved!;
}


/** 优先按手动队列顺序；风险统计则必须按真实截止日期排序。 */
export function orderedCommissions(items: Commission[], includeArchived = false): Commission[] {
  return [...items].filter(c => includeArchived || c.status !== 'archived')
    .sort((a, b) => a.order - b.order || a.dueDate.localeCompare(b.dueDate));
}
export interface PlanRisk {
  commissionId: string;
  requiredMinutes: number;
  availableMinutes: number;
  shortfallMinutes: number;
}
/** 仅计算本地可用时间与冲突，不替用户承诺真实交期。 */
export function calculatePlanRisks(
  workspace: WorkspaceData, fromDate: string = localDate(new Date()),
): PlanRisk[] {
  const open = workspace.commissions
    .filter(c => c.dueDate && c.status === 'active')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.priority - b.priority);
  let required = 0;
  return open.map(c => {
    required += Math.max(0, c.remainingMinutes || 0) + Math.max(0, c.bufferMinutes || 0);
    const start = new Date(fromDate + 'T00:00:00');
    const end = new Date(c.dueDate + 'T00:00:00');
    let available = 0;
    if (Number.isFinite(end.getTime())) {
      for (let day = new Date(start), i = 0; day <= end && i < 366; day.setDate(day.getDate() + 1), i++) {
        const dayKey = localDate(day);
        const busyClasses = workspace.classes
          .filter(item => !item.cancelled && item.weekday === day.getDay()
            && (!item.until || dayKey <= item.until))
          .reduce((sum, item) => {
            const [sh, sm] = item.start.split(':').map(Number);
            const [eh, em] = item.end.split(':').map(Number);
            return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm) || 0);
          }, 0);
        const busyHomework = workspace.homework
          .filter(item => !item.done && item.dueAt.slice(0, 10) === dayKey)
          .reduce((sum, item) => sum + Math.max(0, item.minutes || 0), 0);
        available += Math.max(0, workspace.dailyAvailableMinutes - busyClasses - busyHomework);
      }
    }
    return {
      commissionId: c.id, requiredMinutes: required,
      availableMinutes: available, shortfallMinutes: Math.max(0, required - available),
    };
  });
}

/** 用户开始专注后的聊天是每 5 分钟窗口一次，不可囤积。 */
export function focusChatAllowance(
  session: { mode: 'focus' | 'break'; duration: number; deadline: number;
    pauseRemainingMs?: number; usedChatWindows?: number[] } | null,
  now: number,
): { limit: number; used: number; currentWindow: number; canSend: boolean } {
  if (!session || session.mode !== 'focus') {
    return { limit: 0, used: 0, currentWindow: -1, canSend: true };
  }
  const maxMs = session.duration * 60000;
  const remaining = session.pauseRemainingMs ?? Math.max(0, session.deadline - now);
  const elapsed = Math.max(0, Math.min(maxMs, maxMs - remaining));
  const limit = Math.ceil(session.duration / 5);
  const currentWindow = Math.min(limit - 1, Math.floor(elapsed / 300000));
  const usedWindows = new Set(session.usedChatWindows || []);
  return {
    limit, used: usedWindows.size, currentWindow,
    canSend: session.pauseRemainingMs == null && remaining > 0 && !usedWindows.has(currentWindow),
  };
}
