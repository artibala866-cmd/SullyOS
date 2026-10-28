import type { CharacterLifeEvent } from './characterLifeEvents';

/**
 * Confirmed, previously persisted life fragments for a read-only character profile view.
 * A schedule slot is never a life event, and this selector never writes or asks an AI.
 * Clear/revisions are always respected because callers pass the latest event ledger.
 */
export function selectConfirmedLifeGlimpses(
  events: readonly CharacterLifeEvent[],
  characterId: string,
  now = Date.now(),
  limit = 8,
): CharacterLifeEvent[] {
  if (!characterId || !Number.isFinite(now) || limit <= 0) return [];
  const seen = new Set<string>();
  return events
    .filter(event => {
      if (!event || event.characterId !== characterId || !event.id ||
          !event.summary?.trim() || !Number.isFinite(event.occurredAt) ||
          event.occurredAt <= 0 || event.occurredAt > now || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    })
    .sort((a, b) => b.occurredAt - a.occurredAt || a.id.localeCompare(b.id))
    .slice(0, Math.min(20, Math.floor(limit)));
}
