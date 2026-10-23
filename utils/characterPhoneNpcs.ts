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
  const updated = [profile, ...previous.filter(p => p.id !== profile.id && p.name !== profile.name)];
  saveNpcProfiles(characterId, updated);
  return updated;
}
