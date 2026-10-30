import type { PhoneMessage } from './characterPhoneIdentity';
import { advancePhoneContentClearRevision } from './characterPhoneContentClearRevision';
import { pruneDeletedPhoneChatLifeEvents, CHARACTER_LIFE_EVENTS_CHANGED } from './characterLifeEvents';
import { readNpcProfiles, saveNpcProfiles, CHARACTER_PHONE_CONTACT_CHANGED } from './characterPhoneNpcs';

/** One persisted inbox for the phone UI and autonomous NPC scheduler. */
export type CharacterPhoneChat = {
  id: string;
  contactId?: string;
  kind?: 'npc'|'group'|'service';
  name: string;
  preview: string;
  time: number;
  messages: PhoneMessage[];
};
export const CHARACTER_PHONE_CHATS_CHANGED = 'sully:character-phone-chats-changed';
export const phoneChatStorageKey = (characterId: string) => 'sully_character_phone_wechat_v1:' + characterId;

export function readCharacterPhoneChats(characterId: string): CharacterPhoneChat[] {
  if (!characterId || typeof localStorage === 'undefined') return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(phoneChatStorageKey(characterId)) || '[]');
    return Array.isArray(raw) ? raw.filter((r): r is CharacterPhoneChat =>
      !!r && typeof r.id === 'string' && typeof r.name === 'string' &&
      Array.isArray(r.messages) && Number.isFinite(r.time))
      : [];
  } catch { return []; }
}

export function notifyCharacterPhoneChatsChanged(characterId: string): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_CHATS_CHANGED, { detail: { characterId } }));
}

/** Synchronous read/modify/write. The updater must not call an API or await.
 * Never emits a change event on failed storage. No new inbox format/migration.
 */
export function updateCharacterPhoneChats(
  characterId: string,
  transform: (old: CharacterPhoneChat[]) => CharacterPhoneChat[],
): CharacterPhoneChat[] {
  const previous = readCharacterPhoneChats(characterId);
  const next = transform(previous);
  // A rejected duplicate delivery is not a new phone event. Avoid redundant
  // multi-KB localStorage rewrites, UI reloads and unexpected cross-app refreshes.
  if (next === previous) return previous;
  localStorage.setItem(phoneChatStorageKey(characterId), JSON.stringify(next));
  notifyCharacterPhoneChatsChanged(characterId);
  return next;
}

/** Retire only derived WeChat quotation hints from NPC records, preserving
 * names, identities and notes from other sources. */
export function erasePhoneWechatRelationshipNotes(
  characterId:string,contactIds?:readonly string[],
):void{
  const affected=contactIds?new Set(contactIds):null;
  const previous=readNpcProfiles(characterId);
  let changed=false;
  const next=previous.map(p=>{
    if(affected&&!affected.has(p.id))return p;
    const notes=(p.relationshipNotes||'').split('\n');
    const retained=notes.filter(n=>!n.includes('微信提及]'));
    if(retained.length===notes.length)return p;
    changed=true;
    return {...p,relationshipNotes:retained.join('\n')};
  });
  if(!changed)return;
  saveNpcProfiles(characterId,next);
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(
    CHARACTER_PHONE_CONTACT_CHANGED,{detail:{characterId}}));
}

/** User deleting an NPC WeChat chat must remove its derived life context and
 * invalidate any in-flight autonomous write that could resurrect it. */
export function deleteCharacterPhoneChat(characterId:string,threadId:string):boolean{
  const thread=readCharacterPhoneChats(characterId).find(row=>row.id===threadId);
  if(!thread)return false;
  advancePhoneContentClearRevision(characterId,'chats');
  updateCharacterPhoneChats(characterId,rows=>rows.filter(row=>row.id!==threadId));
  const removed=pruneDeletedPhoneChatLifeEvents(characterId,thread);
  if(thread.contactId)erasePhoneWechatRelationshipNotes(characterId,[thread.contactId]);
  // Even if a legacy thread had no matching life event, the AMSG fire_pack may
  // still hold its contact's cached WeChat excerpts. Invalidate that snapshot.
  if(!removed && typeof window!=='undefined')window.dispatchEvent(new CustomEvent(
    CHARACTER_LIFE_EVENTS_CHANGED,{detail:{characterId,pruned:true,threadId}},
  ));
  return true;
}

export function appendCharacterPhoneMessages(input: {
  characterId: string;
  contactId: string;
  contactName: string;
  messages: PhoneMessage[];
  at?: number;
  /** An offline cloud reply must be appended ONLY if the exact original
   * unanswered thread still exists. Never re-create a deleted conversation.
   * Checked in the same synchronous storage transform as the append. */
  expectedLatest?: { threadId: string; messageCount: number; lastAt: number; lastText: string };
}): { thread: CharacterPhoneChat; added: PhoneMessage[] } | null {
  if (!input.characterId || !input.contactId || !input.messages.length) return null;
  const at = input.at ?? Date.now();
  let result: { thread: CharacterPhoneChat; added: PhoneMessage[] } | null = null;
  updateCharacterPhoneChats(input.characterId, old => {
    const previous = old.find(r => r.contactId === input.contactId);
    if (input.expectedLatest) {
      const expected = input.expectedLatest;
      const last = previous?.messages[previous.messages.length - 1];
      if (!previous || previous.id !== expected.threadId ||
          previous.messages.length !== expected.messageCount ||
          last?.speaker?.role !== 'contact' ||
          (last.createdAt || previous.time) !== expected.lastAt ||
          typeof last.text !== 'string' || last.text.slice(0, 300) !== expected.lastText) {
        return old;
      }
    }
    // Repeated short human phrases are legitimate hours later. Reject only
    // immediate duplicated deliveries/retries, not every historical "嗯".
    const recent = new Set((previous?.messages || []).slice(-12)
      .filter(m => at - (m.createdAt || previous?.time || 0) < 10 * 60_000)
      .map(m => m.speaker.role + '|' + m.text.trim()));
    const knownCloudIds = new Set((previous?.messages || []).map(m => m.cloudSourceId).filter(Boolean));
    const added = input.messages.filter(m => {
      if (!m.text?.trim() || m.speaker.role === 'user') return false;
      if (m.cloudSourceId && knownCloudIds.has(m.cloudSourceId)) return false;
      if (m.cloudSourceId) knownCloudIds.add(m.cloudSourceId);
      const key = m.speaker.role + '|' + m.text.trim();
      // Cloud messages already have a globally stable source ID. A repeated
      // short phrase can be an intentional separate NPC turn; text-based
      // duplicate suppression must not silently discard it.
      if (!m.cloudSourceId && recent.has(key)) return false;
      recent.add(key);
      return true;
    });
    if (!added.length) return old;
    const thread: CharacterPhoneChat = {
      id: previous?.id || crypto.randomUUID(),
      contactId: input.contactId,
      name: previous?.name || input.contactName,
      preview: added[added.length - 1].text,
      time: at,
      messages: [...(previous?.messages || []), ...added.map((m, i) => ({
        ...m, createdAt: m.createdAt || at - (added.length - i - 1) * 1000,
      }))].slice(-500),
    };
    result = { thread, added };
    return [thread, ...old.filter(r => r.id !== previous?.id)];
  });
  return result;
}
