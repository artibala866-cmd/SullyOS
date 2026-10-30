/** Global entry for the EXISTING AMSG2 cloud autonomous contact scheduler.
 * This is not another scheduler, task type, or LLM caller. It reconciles the
 * roles already explicitly enabled by their owners, including while Chat is
 * not mounted. Cloud execution stays exclusively in the existing Worker.
 */
import type { ActiveMsg2CharacterConfig, APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../types';
import { ensureAutonomyWakes } from './amsgAutonomyWake';

export type GlobalAutonomyWakeScope = {
  getCharacters: () => CharacterProfile[];
  getUserProfile: () => UserProfile | null | undefined;
  getApiConfig: () => APIConfig;
  getGroups: () => GroupProfile[];
  getRealtimeConfig: () => RealtimeConfig;
  /** Persist via the existing OSContext.updateCharacter merge, never a competing store. */
  saveCharacterConfig: (id: string, update: (prev: ActiveMsg2CharacterConfig | undefined) => ActiveMsg2CharacterConfig) => void;
  /** Only controls starting more work and updating mounted React state; not a user opt-out. */
  isActive: () => boolean;
};

/** One bounded pass over explicitly opted-in characters; safe when there are no manual tasks.
 * Per-character Web Locks and D1 identity are inside ensureAutonomyWakes.
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
    const user = scope.getUserProfile();
    if (!char || char.activeMsg2Config?.enabled !== true || !user) continue;
    try {
      await ensureAutonomyWakes({
        char,
        apiConfig: scope.getApiConfig(),
        userProfile: user,
        groups: scope.getGroups(),
        realtimeConfig: scope.getRealtimeConfig(),
        // Closing the browser isn't disabling 2.0. A cloud task already
        // accepted by the Worker must NOT be rolled back just because the
        // React provider unmounted while the network request was in flight.
        // The authoritative opt-out is the actual character flag, not isActive.
        isEnabledNow: () => scope.getCharacters().some(c =>
          c.id === id && c.activeMsg2Config?.enabled === true),
        onSave: update => {
          // Async cloud work might finish after Char was deleted or 2.0 turned off.
          if (!scope.isActive() || !scope.getCharacters().some(c =>
            c.id === id && c.activeMsg2Config?.enabled === true)) return;
          scope.saveCharacterConfig(id, prev =>
            prev?.enabled === false ? prev : update(prev));
        },
      });
    } catch (error) {
      // A broken role must not prevent later enabled characters from healing.
      console.warn('[AMSG2] global autonomous wake reconciliation failed', id, error);
    }
  }
}
