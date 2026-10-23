export type NpcProfile = {
  id: string;
  name: string;
  identity: string;
  personality: string;
  relationship: string;
  background: string;
  source: 'generated' | 'chat' | 'xiaohongshu' | 'character';
  linkedCharacterId?: string;
  createdAt: number;
};
export const npcStorageKey = (characterId: string) => 'sully_character_phone_npcs_v1:' + characterId;
export function readNpcProfiles(characterId: string): NpcProfile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(npcStorageKey(characterId)) || '[]');
    return Array.isArray(value) ? value.filter((p): p is NpcProfile => !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.relationship === 'string') : [];
  } catch { return []; }
}
export function saveNpcProfiles(characterId: string, profiles: NpcProfile[]) {
  localStorage.setItem(npcStorageKey(characterId), JSON.stringify(profiles));
}
// Shared registration interface for future real-mode, chat and Xiaohongshu events.
// Caller must supply a profile grounded in the source character's persona.
export function registerNpcProfile(characterId: string, profile: NpcProfile): NpcProfile[] {
  const previous = readNpcProfiles(characterId);
  const updated = [profile, ...previous.filter(p => p.id !== profile.id)];
  saveNpcProfiles(characterId, updated);
  return updated;
}

/** A single event channel for future real-mode and AMSG 2.0 integrations.
 * Never invents NPCs: callers must provide a persona-grounded profile.
 * Existing manual edits are authoritative and are not overwritten by automation.
 */
export const CHARACTER_PHONE_CONTACT_CHANGED = 'sully:character-phone-contact-changed';
export function addDiscoveredContact(characterId: string, profile: NpcProfile): { added: boolean; profile: NpcProfile } {
  if (!characterId || !profile.id || !profile.name.trim() || !profile.identity.trim() ||
      !profile.personality.trim() || !profile.relationship.trim() || !profile.background.trim()) {
    throw new Error('联系人资料不完整，无法自动添加');
  }
  if (profile.source === 'character' && !profile.linkedCharacterId) {
    throw new Error('其他 Char 联系人必须关联真实角色 ID');
  }
  const previous = readNpcProfiles(characterId);
  const existing = previous.find(p => p.id === profile.id ||
    (profile.linkedCharacterId && p.linkedCharacterId === profile.linkedCharacterId));
  if (existing) return { added: false, profile: existing };
  saveNpcProfiles(characterId, [...previous, profile]);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_CONTACT_CHANGED, { detail: { characterId, contactId: profile.id } }));
  return { added: true, profile };
}
