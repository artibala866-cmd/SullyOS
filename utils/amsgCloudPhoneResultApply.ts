/** Stage 4 durable cloud NPC result: the browser owns the real phone and
 * is the only place where a cloud suggestion can become a saved interaction.
 * Outbox redelivery is idempotent; deletion/off/revision or changed inbox
 * always wins over older cloud work. No new LLM request is made here.
 */
import { DB } from './db';
import { isCloudPhonePiggybackAuthorized, parseCloudPhoneResult } from './amsgCloudPhone';
import { readCharacterPhoneChats, appendCharacterPhoneMessages } from './characterPhoneChats';
import { readNpcProfiles } from './characterPhoneNpcs';
import { readPhoneAutonomyPreferences, readPhoneAutonomyRevision } from './characterPhoneApiBudget';
import { readPhoneContentClearRevision } from './characterPhoneContentClearRevision';
import { readCharacterLifeEvents, recordCharacterLifeEvent } from './characterLifeEvents';
import { markPhoneAutonomyOpportunityAttempt } from './characterPhoneOpportunity';
import { withAutonomyWakeLock } from './amsgAutonomyLock';
import type { AmsgResultContext } from './amsgResults';

export async function applyCloudPhoneResult(payload: unknown, context?: AmsgResultContext): Promise<boolean> {
  const row = parseCloudPhoneResult(payload);
  if (!row) return true; // Bad shape can never become safe by retrying.
  // No replay of very old phone scripts when the app reconnects weeks later.
  if (Date.now() - row.occurredAt > 7 * 86400_000 || row.occurredAt > Date.now() + 60000)
    return true;
  const id = row.id;
  const apply = async (): Promise<boolean> => {
    const chars = await DB.getAllCharacters();
    const char = chars.find(c => c.id === row.charId);
    if (!char) return true;
    const prefs = readPhoneAutonomyPreferences(row.charId);
    if (!isCloudPhonePiggybackAuthorized(char.activeMsg2Config?.enabled === true,
      prefs.chatPiggybackEnabled) ||
      readPhoneAutonomyRevision(row.charId) !== row.revision ||
      readPhoneContentClearRevision(row.charId, 'chats') !== row.clearRevision) return true;
    const contact = readNpcProfiles(row.charId).find(c => c.id === row.contactId && c.source !== 'character' && !c.linkedCharacterId);
    if (!contact) return true;
    const thread = readCharacterPhoneChats(row.charId).find(t => t.id === row.threadId && t.contactId === contact.id);
    if (!thread) return true;
    // If the same outbox result already landed, repair its life event even if
    // the NPC inbox has since advanced; do not append another cloud message.
    const previous = thread.messages.filter(m => m.cloudSourceId?.startsWith(id + ':'));
    if (!previous.length) {
      const last = thread.messages[thread.messages.length - 1];
      if (thread.messages.length !== row.replyToCount || last?.speaker?.role !== 'contact' ||
        (last.createdAt || thread.time) !== row.replyToAt ||
        typeof last.text !== 'string' || last.text.slice(0, 300) !== row.replyToText ||
        row.sourceKey !== 'reply:' + thread.id + ':' + row.replyToAt + ':' + row.replyToCount) return true;
      try {
        const added = appendCharacterPhoneMessages({
          characterId: row.charId, contactId: contact.id,
          contactName: contact.remark || contact.nickname || contact.name,
          at: row.occurredAt,
          // Re-check inside the phone storage mutation, not only before it:
          // other tabs/user deletion must not turn a late cloud response into
          // a brand-new chat after its original thread vanished.
          expectedLatest: {
            threadId: row.threadId, messageCount: row.replyToCount,
            lastAt: row.replyToAt, lastText: row.replyToText,
          },
          messages: row.messages.map((text, i) => ({
            speaker: { role:'owner' as const }, text,
            createdAt: row.occurredAt + i * 1000,
            cloudSourceId: id + ':' + i,
          })),
        });
        if (!added?.added.length) return true;
      } catch { return false; } // Storage full: keep server outbox for retry.
    }
    const eventId = 'npc-chat:cloud:' + id;
    if (!readCharacterLifeEvents(row.charId).some(e => e.id === eventId)) {
      const saved = recordCharacterLifeEvent({
        id: eventId, characterId: row.charId, kind: 'npc-chat',
        occurredAt: row.occurredAt, source: 'phone', contactId: contact.id,
        phoneThreadId: row.threadId,
        summary: '通过云端自主机会回复' + contact.name + '的微信：' + row.messages.join('；').slice(0, 800),
      });
      if (!saved && !readCharacterLifeEvents(row.charId).some(e => e.id === eventId)) return false;
    }
    markPhoneAutonomyOpportunityAttempt(row.charId, row.sourceKey);
    return true;
  };
  // Local cross-tab safety; the preexisting phone inbox remains the sole store.
  const outcome = await withAutonomyWakeLock('phone-cloud:' + row.charId, apply);
  return outcome ?? false;
}
