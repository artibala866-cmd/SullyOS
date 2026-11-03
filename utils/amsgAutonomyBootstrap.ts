import type { ActiveMsg2CharacterConfig, CharacterProfile } from '../types';
import { retireAutonomyWakes } from './amsgAutonomyWake';
import { isPendingTask } from './amsg2Tasks';

export type GlobalAutonomyWakeScope = {
  getCharacters: () => CharacterProfile[];
  /** Persist via the existing OSContext.updateCharacter merge, never a competing store. */
  saveCharacterConfig: (id: string, update: (prev: ActiveMsg2CharacterConfig | undefined) => ActiveMsg2CharacterConfig) => void;
  /** Only controls starting more work and updating mounted React state; not a user opt-out. */
  isActive: () => boolean;
};

/** Reconcile retired daily jobs for roles whose ordinary cloud tasks remain enabled.
 * Per-character Web Locks serialize the cleanup across tabs.
 */
export async function reconcileGlobalAutonomyWakes(
  scope: GlobalAutonomyWakeScope,
  requestedCharId?: string,
): Promise<void> {
  if (!scope.isActive()) return;
  const targets = scope.getCharacters()
    .filter(c => !!c.id && c.activeMsg2Config?.enabled === true &&
      (!requestedCharId || c.id === requestedCharId))
    .map(c => c.id);
  for (const id of targets) {
    if (!scope.isActive()) return;
    const char = scope.getCharacters().find(c => c.id === id);
    if (!char || char.activeMsg2Config?.enabled !== true) continue;
    try {
      await retireAutonomyWakes(char, update => {
        if (!scope.isActive() || !scope.getCharacters().some(c => c.id === id && c.activeMsg2Config?.enabled === true)) return;
        scope.saveCharacterConfig(id, prev => prev?.enabled === true ? update(prev) : prev ?? { enabled: false });
      });
    } catch (error) {
      // A broken role must not prevent later enabled characters from healing.
      console.warn('[AMSG2] global autonomous wake reconciliation failed', id, error);
    }
  }
}

/** Inputs that require an OS reconciliation. No IO and no state mutation.
 * Autonomous task saves are outputs, so they MUST NOT retrigger their runner.
 * Manual task capacity, opt-in and timezone changes are real input changes. */
export function autonomyReconciliationKey(
  characters: readonly CharacterProfile[], nowMs = Date.now(),
): string {
  return characters.filter(c => !!c?.id && c.activeMsg2Config != null && typeof c.activeMsg2Config === 'object').map(c => {
    const config = c.activeMsg2Config!;
    const tasks = Array.isArray(config.tasks) ? config.tasks : [];
    const manualPending = tasks.filter(t => t && typeof t === 'object'
      && !(typeof t.clientTaskId === 'string' && t.clientTaskId.startsWith('autowake:'))
      && isPendingTask(t, nowMs)).length;
    return JSON.stringify([c.id, config.enabled === true, manualPending,
      typeof config.maxActiveTasks === 'number' ? config.maxActiveTasks : null,
      c.customTimezoneEnabled === true, typeof c.customTimezone === 'string' ? c.customTimezone : null]);
  }).sort().join('|');
}
