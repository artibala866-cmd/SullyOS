/** The client remains authoritative for NPC-phone permissions and history.
 * This is only a bounded, read-only cloud snapshot when piggyback was opted in.
 */
import type { CharacterProfile } from '../types';
import { readPhoneAutonomyPreferences, readPhoneAutonomyRevision } from './characterPhoneApiBudget';
import { readPhoneContentClearRevision } from './characterPhoneContentClearRevision';
import { readNpcProfiles } from './characterPhoneNpcs';
import { readCharacterPhoneChats } from './characterPhoneChats';
import { findPhoneAutonomyOpportunity } from './characterPhoneOpportunity';
import { isCloudPhonePiggybackAuthorized, type CloudPhoneOpportunity } from './amsgCloudPhone';

export function selectCloudPhoneOpportunity(char: CharacterProfile, now = Date.now()): CloudPhoneOpportunity | null {
  if (!char?.id) return null;
  const prefs = readPhoneAutonomyPreferences(char.id);
  if (!isCloudPhonePiggybackAuthorized(char.activeMsg2Config?.enabled === true,
      prefs.chatPiggybackEnabled)) return null;
  const found = findPhoneAutonomyOpportunity(char.id, now);
  if (!found || found.kind !== 'unanswered-npc') return null;
  const contacts = new Map(readNpcProfiles(char.id).filter(c => c.source !== 'character' && !c.linkedCharacterId)
    .map(c => [c.id, c]));
  const thread = readCharacterPhoneChats(char.id).find(t =>
    t.contactId && contacts.has(t.contactId) && t.kind !== 'group' && t.kind !== 'service' &&
    found.key.startsWith('reply:' + t.id + ':'));
  if (!thread?.contactId) return null;
  const last = thread.messages[thread.messages.length - 1];
  if (!last || last.speaker?.role !== 'contact' ||
    typeof last.text !== 'string' || !last.text.trim()) return null;
  const at = last.createdAt || thread.time;
  if (found.key !== 'reply:' + thread.id + ':' + at + ':' + thread.messages.length) return null;
  const contact = contacts.get(thread.contactId);
  if (!contact) return null;
  return {
    contactId: contact.id, contactName: (contact.remark || contact.nickname || contact.name).slice(0, 50),
    threadId: thread.id, sourceKey: found.key,
    replyToAt: at, replyToCount: thread.messages.length,
    replyToText: last.text.slice(0, 300),
    history: thread.messages.filter(m =>
      !!m && typeof m.text === 'string' &&
      (m.speaker?.role === 'owner' || m.speaker?.role === 'contact')).slice(-5).map(m => ({
      speaker: m.speaker.role === 'owner' ? 'owner' as const : 'contact' as const,
      text: m.text.slice(0, 200),
    })),
    revision: readPhoneAutonomyRevision(char.id),
    clearRevision: readPhoneContentClearRevision(char.id, 'chats'),
  };
}

/** Optional NPC data must never break ordinary cloud contact scheduling. */
export function safelySelectCloudPhoneOpportunity(char: CharacterProfile, now = Date.now()): CloudPhoneOpportunity | null {
  try { return selectCloudPhoneOpportunity(char, now); }
  catch (error) {
    console.warn('[AMSG2] optional cloud NPC snapshot skipped (invalid phone data)', error);
    return null;
  }
}
