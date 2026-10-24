import type { PhoneMessage } from './characterPhoneIdentity';

/** One persisted inbox for the phone UI and autonomous NPC scheduler. */
export type CharacterPhoneChat = {
  id: string;
  contactId?: string;
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
  const next = transform(readCharacterPhoneChats(characterId));
  localStorage.setItem(phoneChatStorageKey(characterId), JSON.stringify(next));
  notifyCharacterPhoneChatsChanged(characterId);
  return next;
}

export function appendCharacterPhoneMessages(input: {
  characterId: string;
  contactId: string;
  contactName: string;
  messages: PhoneMessage[];
  at?: number;
}): { thread: CharacterPhoneChat; added: PhoneMessage[] } | null {
  if (!input.characterId || !input.contactId || !input.messages.length) return null;
  const at = input.at ?? Date.now();
  let result: { thread: CharacterPhoneChat; added: PhoneMessage[] } | null = null;
  updateCharacterPhoneChats(input.characterId, old => {
    const previous = old.find(r => r.contactId === input.contactId);
    const recent = new Set((previous?.messages || []).slice(-24).map(m =>
      m.speaker.role + '|' + m.text.trim()));
    const added = input.messages.filter(m => {
      if (!m.text?.trim() || m.speaker.role === 'user') return false;
      const key = m.speaker.role + '|' + m.text.trim();
      if (recent.has(key)) return false;
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
