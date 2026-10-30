export type NpcProfile = {
  id: string;
  name: string;
  nickname?: string;
  avatar?: string;
  realName?: string;
  remark?: string;
  identity: string;
  personality: string;
  relationship: string;
  background: string;
  /** Optional persistent social traits; older NPC records remain valid. */
  speechStyle?: string;
  boundary?: string;
  relationshipNotes?: string;
  lastInteractedAt?: number;
  interactionCount?: number;
  originEvidence?: 'worldbook' | 'character' | 'social' | 'suggested';
  /** Explicitly known shared contacts, not inferred from all of Char's friends. */
  mutualContactIds?: string[];
  source: 'generated' | 'chat' | 'xiaohongshu' | 'character';
  linkedCharacterId?: string;
  createdAt: number;
};
export const npcStorageKey = (characterId: string) => 'sully_character_phone_npcs_v1:' + characterId;
export function readNpcProfiles(characterId: string): NpcProfile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(npcStorageKey(characterId)) || '[]');
    return Array.isArray(value) ? value
      .filter((p): p is NpcProfile => !!p && typeof p.id === 'string' &&
        typeof p.name === 'string' && !!p.id && !!p.name.trim() &&
        typeof p.relationship === 'string')
      .map(p => ({
        ...p,
        identity: typeof p.identity === 'string' ? p.identity : '生活圈联系人',
        personality: typeof p.personality === 'string' ? p.personality : '尚不了解',
        background: typeof p.background === 'string' ? p.background : '',
        relationshipNotes: typeof p.relationshipNotes === 'string' ? p.relationshipNotes : '',
        speechStyle: typeof p.speechStyle === 'string' ? p.speechStyle : '',
        boundary: typeof p.boundary === 'string' ? p.boundary : '',
        mutualContactIds: Array.isArray(p.mutualContactIds)
          ? p.mutualContactIds.filter((id): id is string => typeof id === 'string' && !!id).slice(0, 50) : [],
      })) : [];
  } catch { return []; }
}
/** Every confirmed contact edit, not only addDiscoveredContact, must
 * invalidate the optional cloud-phone candidate in the existing AMSG state
 * sync. A deleted/renamed NPC must not linger in a stale Worker fire_pack.
 * Notify only after the local save succeeds; never emit for failed storage.
 */
export function saveNpcProfiles(characterId: string, profiles: NpcProfile[], contactId?: string) {
  localStorage.setItem(npcStorageKey(characterId), JSON.stringify(profiles));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(
    CHARACTER_PHONE_CONTACT_CHANGED, { detail: { characterId, ...(contactId ? { contactId } : {}) } },
  ));
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
  saveNpcProfiles(characterId, [...previous, profile], profile.id);
  return { added: true, profile };
}
