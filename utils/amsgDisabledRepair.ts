/**
 * Reconcile the EXISTING AMSG2 Worker after its owner turned scheduling OFF.
 *
 * The disable-modal attempts to revoke cloud limits and cancel tasks once.
 * A network failure or a task created while that request was in flight can
 * leave a recurring remote job able to spend API credits for days. Repair is
 * re-run on app resume; no LLM call, no new scheduler, and no instant-chat or
 * unrelated local App job is altered.
 */
import type { CharacterProfile } from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { AMSG_INSTANT_CHAT_SUBTYPE } from './amsgFirePack';
import { AMSG_BACKGROUND_JOB_SUBTYPE } from './amsgTaskKinds';

type Scope = {
  getCharacters: () => CharacterProfile[];
  isActive: () => boolean;
  saveCharacterConfig: (
    charId: string,
    update: (prev: CharacterProfile['activeMsg2Config']) => NonNullable<CharacterProfile['activeMsg2Config']>,
  ) => void;
};

const nextAudit = new Map<string, number>();
const inFlight = new Set<string>();
const RECOVER_RETRY_MS = 90_000;
const HEALTHY_AUDIT_MS = 60 * 60_000;

/** Called by the explicit OFF switch; a former successful audit must not
 * prevent fresh cancellation when the role was enabled again in between. */
export const requestImmediateDisabledAmsgRepair = (charId: string) => {
  if (charId) nextAudit.delete(charId);
};

export async function reconcileDisabledAmsgTasks(scope: Scope, requestedCharId?: string): Promise<void> {
  if (!scope.isActive()) return;
  for (const original of scope.getCharacters()) {
    if (!scope.isActive()) return;
    if (requestedCharId && requestedCharId !== original.id) continue;
    if (!original.id || original.activeMsg2Config?.enabled !== false ||
      inFlight.has(original.id) || Date.now() < (nextAudit.get(original.id) ?? 0)) continue;
    const id = original.id;
    const isStillOff = () => scope.getCharacters().some(c =>
      c.id === id && c.activeMsg2Config?.enabled === false);
    inFlight.add(id);
    let cloudBlocked = false;
    let inventoryRead = false;
    const failed = new Set<string>();
    const cancelled = new Set<string>();
    try {
      // Tell the Worker to stop BEFORE listing/deleting jobs. If a task fires
      // during cleanup, this permission gate stops the paid generation.
      try {
        if (!isStillOff()) continue;
        const latest = scope.getCharacters().find(c => c.id === id);
        if (!latest) continue;
        await ActiveMsgClient.putCharLimits(latest);
        cloudBlocked = true;
      } catch (error) {
        console.warn('[AMSG2] disabled cloud consent sync still pending', id, error);
      }

      try {
        if (!isStillOff()) continue;
        // The remote list, not the potentially incomplete local task list,
        // is the source of truth. Exclude instant user-turn replies.
        const remote = await ActiveMsgClient.listRemoteTasksForChar(id);
        inventoryRead = true;
        const localUuids = scope.getCharacters().find(c => c.id === id)
          ?.activeMsg2Config?.tasks?.map(t => t.taskUuid) ?? [];
        const targets = new Set([
          ...remote.filter(t => t.messageSubtype !== AMSG_INSTANT_CHAT_SUBTYPE &&
            t.messageSubtype !== AMSG_BACKGROUND_JOB_SUBTYPE).map(t => t.uuid),
          ...localUuids,
        ]);
        for (const uuid of targets) {
          if (!isStillOff()) break;
          try { await ActiveMsgClient.cancelTask(uuid); cancelled.add(uuid); }
          catch (error) {
            failed.add(uuid);
            console.warn('[AMSG2] disabled role remote cancellation still pending', id, uuid, error);
          }
        }
      } catch (error) {
        console.warn('[AMSG2] disabled role cloud inventory unavailable; retry scheduled', id, error);
      }

      if (scope.isActive() && isStillOff()) {
        const errorText = !cloudBlocked
          ? '主动消息已关闭，但云端停止授权尚未同步成功，可能仍调用 API；会自动重试'
          : !inventoryRead || failed.size
            ? '主动消息已关闭，但仍有远端任务未确认取消；会自动重试'
            : undefined;
        const prev = scope.getCharacters().find(c => c.id === id)?.activeMsg2Config;
        const oldTasks = prev?.tasks ?? [];
        const hasRemoved = oldTasks.some(t => cancelled.has(t.taskUuid));
        const hasOwnError = typeof prev?.lastError === 'string' &&
          (prev.lastError.startsWith('主动消息已关闭，但') || prev.lastError.startsWith('关闭时远端取消失败'));
        if (hasRemoved || errorText || hasOwnError) {
          scope.saveCharacterConfig(id, config => ({
            ...(config ?? { enabled: false }),
            enabled: false,
            tasks: (config?.tasks ?? []).filter(t => !cancelled.has(t.taskUuid)),
            lastError: errorText ?? (hasOwnError ? undefined : config?.lastError),
            lastSyncedAt: Date.now(),
          }));
        }
      }
    } finally {
      nextAudit.set(id, Date.now() + (cloudBlocked && inventoryRead && failed.size === 0
        ? HEALTHY_AUDIT_MS : RECOVER_RETRY_MS));
      inFlight.delete(id);
    }
  }
}
