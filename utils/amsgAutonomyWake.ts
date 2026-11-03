import type { ActiveMsg2CharacterConfig, CharacterProfile } from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { withAutonomyWakeLock } from './amsgAutonomyLock';
import { markReplyStopped } from './chatReplyCancellation';

import { isAutonomyWakeTask } from './amsgRetiredAutonomy';

const nextAudit = new Map<string, number>();
export function allowImmediateAutonomyWakeRetry(charId: string): void {
  nextAudit.delete(charId);
}

/** Close the old daily generator first, then reconcile only identified daily jobs. */
export async function retireAutonomyWakes(
  char: CharacterProfile,
  onSave: (update: (previous: ActiveMsg2CharacterConfig) => ActiveMsg2CharacterConfig) => void,
): Promise<void> {
  await withAutonomyWakeLock(char.id, async () => {
    if (Date.now() < (nextAudit.get(char.id) ?? 0)) return;
    const cancelled = new Set<string>();
    const tasks = char.activeMsg2Config?.tasks;
    const targets = new Set((Array.isArray(tasks) ? tasks : [])
      .filter(isAutonomyWakeTask).map(task => task.taskUuid).filter(Boolean));
    for (const uuid of targets) markReplyStopped(uuid);
    let gateClosed = false;
    let inventoryRead = false;
    let cancellationFailed = false;
    try {
      await ActiveMsgClient.putCharLimits(char);
      gateClosed = true;
    } catch { /* Inventory and cancellation can still succeed independently. */ }
    try {
      const remote = await ActiveMsgClient.listRemoteTasksForChar(char.id);
      inventoryRead = true;
      for (const task of remote.filter(isAutonomyWakeTask)) {
        markReplyStopped(task.uuid);
        if (!['cancelled', 'completed'].includes(task.status ?? '')) targets.add(task.uuid);
        else cancelled.add(task.uuid);
      }
    } catch { /* Keep known local IDs and try them even if inventory is unavailable. */ }
    for (const uuid of targets) {
      if (cancelled.has(uuid)) continue;
      try {
        await ActiveMsgClient.cancelTask(uuid);
        cancelled.add(uuid);
      } catch { cancellationFailed = true; }
    }
    const complete = gateClosed && inventoryRead && !cancellationFailed;
    nextAudit.set(char.id, Date.now() + (complete ? 60 * 60_000 : 90_000));
    const oldError = char.activeMsg2Config?.lastError;
    const hadWakeError = /^(旧每日联系|自主联系建立失败|真人感关闭同步失败|真人感已关闭)/.test(oldError ?? '');
    if (cancelled.size || !complete || hadWakeError) {
      onSave(previous => ({
        ...previous,
        tasks: (Array.isArray(previous.tasks) ? previous.tasks : []).filter(task => !task || !cancelled.has(task.taskUuid)),
        lastError: !gateClosed
          ? '旧每日联系的云端停用尚未同步，会自动重试'
          : !complete ? '旧每日联系已停用，仍有云端任务待确认清理'
          : hadWakeError && previous.lastError === oldError ? undefined : previous.lastError,
      }));
    }
  });
}
