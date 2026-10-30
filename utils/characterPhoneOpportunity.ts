/**
 * Cheap, read-only eligibility checks for the existing foreground phone runner.
 * A budget tier is a ceiling, never the reason a character starts acting.
 * Actual phone actions still use their original controllers and data stores.
 */
import { readCharacterLifeEvents } from './characterLifeEvents';
import { readCharacterPhoneChats } from './characterPhoneChats';
import { readNpcProfiles } from './characterPhoneNpcs';

export type PhoneAutonomyOpportunity = {
  key: string;
  kind: 'unanswered-npc' | 'life-event';
  eventKind?: 'proactive-message' | 'activity' | 'market-purchase';
};
const SEEN_PREFIX = 'sully_phone_opportunity_seen_v1:';
const MAX_EVENT_AGE_MS = 12 * 60 * 60_000;
const MAX_REPLY_AGE_MS = 72 * 60 * 60_000;
const MIN_REPLY_DELAY_MS = 7 * 60_000;
const MAX_SEEN = 100;

function readSeen(charId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_PREFIX + charId) || '[]');
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(-MAX_SEEN) : [];
  } catch { return []; }
}

/** Only saved, grounded reasons are eligible; a periodic timer is not a reason. */
/** Optionally restrict the NPC set for cloud piggyback. A linked real Char or
 * service conversation must not mask a later eligible fictional NPC reply.
 * Foreground callers without a filter keep their established behavior.
 */
export function findPhoneAutonomyOpportunity(
  charId: string, now = Date.now(), eligibleContactIds?: ReadonlySet<string>,
): PhoneAutonomyOpportunity | null {
  if (!charId || typeof localStorage === 'undefined') return null;
  const seen = new Set(readSeen(charId));
  const known = new Set(readNpcProfiles(charId)
    .filter(x => !eligibleContactIds || eligibleContactIds.has(x.id)).map(x => x.id));
  const unanswered = readCharacterPhoneChats(charId)
    .filter(t => t.contactId && known.has(t.contactId) && t.kind !== 'service' && t.kind !== 'group')
    .flatMap(t => {
      const last = t.messages[t.messages.length - 1];
      // Older imported chats can contain blank/mismatched NPC rows. Such
      // records are not a grounded motive and must not starve other contacts.
      if (last?.speaker?.role !== 'contact' ||
          typeof last.text !== 'string' || !last.text.trim() ||
          (last.speaker.contactId && last.speaker.contactId !== t.contactId)) return [];
      const at = last.createdAt || t.time;
      if (!Number.isSafeInteger(at) || at <= 0) return [];
      const age = now - at;
      const key = 'reply:' + t.id + ':' + at + ':' + t.messages.length;
      return age >= MIN_REPLY_DELAY_MS && age <= MAX_REPLY_AGE_MS && !seen.has(key)
        ? [{ key, at }] : [];
    })
    .sort((a, b) => a.at - b.at);
  if (unanswered.length) return { key: unanswered[0].key, kind: 'unanswered-npc' };

  const events = readCharacterLifeEvents(charId);
  for (const event of events) {
    if (event.source === 'phone' ||
        (event.kind !== 'proactive-message' && event.kind !== 'activity' && event.kind !== 'market-purchase')) continue;
    const age = now - event.occurredAt;
    const key = 'event:' + event.id;
    if (age >= 0 && age <= MAX_EVENT_AGE_MS && !seen.has(key))
      return { key, kind: 'life-event', eventKind: event.kind };
  }
  return null;
}

/** Called only after a real paid API attempt, including uncertain timeout results. */
export function markPhoneAutonomyOpportunityAttempt(charId: string, key: string): boolean {
  if (!charId || !key || typeof localStorage === 'undefined') return false;
  try {
    const seen = readSeen(charId).filter(value => value !== key);
    localStorage.setItem(SEEN_PREFIX + charId, JSON.stringify([...seen, key].slice(-MAX_SEEN)));
    return true;
  } catch { return false; }
}
