/** Character-owned avatar choices. No character profile is mutated by these helpers. */
export type CharacterAvatarEntry = {
  id: string;
  image: string;
  createdAt: number;
  source: 'upload' | 'chat' | 'generated';
};
export type CharacterAvatarLibrary = {
  entries: CharacterAvatarEntry[];
  activeId?: string;
  lastChangedAt?: number;
  autonomousEnabled: boolean;
};
const key = (id: string) => 'sully_character_avatar_library_v1_' + id;
const empty = (): CharacterAvatarLibrary => ({ entries: [], autonomousEnabled: false });
export function readCharacterAvatarLibrary(characterId: string): CharacterAvatarLibrary {
  if (!characterId) return empty();
  try {
    const raw = JSON.parse(localStorage.getItem(key(characterId)) || 'null');
    if (!raw || !Array.isArray(raw.entries)) return empty();
    return {
      entries: raw.entries.filter((e: any) => typeof e?.id === 'string' && typeof e?.image === 'string'),
      activeId: typeof raw.activeId === 'string' ? raw.activeId : undefined,
      lastChangedAt: Number.isFinite(raw.lastChangedAt) ? raw.lastChangedAt : undefined,
      autonomousEnabled: raw.autonomousEnabled === true,
    };
  } catch { return empty(); }
}
export function saveCharacterAvatarLibrary(characterId: string, data: CharacterAvatarLibrary): void {
  if (!characterId) throw new Error('Missing character id');
  localStorage.setItem(key(characterId), JSON.stringify(data));
}
export function addCharacterAvatar(characterId: string, image: string, source: CharacterAvatarEntry['source'] = 'upload'): CharacterAvatarEntry {
  if (!image || !/^(https?:\/\/|data:image\/|blobref:|blob-ref:|blob:|asset:|\/assets\/)/i.test(image)) {
    throw new Error('Unsupported avatar image reference');
  }
  const lib = readCharacterAvatarLibrary(characterId);
  const existing = lib.entries.find(e => e.image === image);
  if (existing) return existing;
  const entry: CharacterAvatarEntry = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2),
    image, source, createdAt: Date.now(),
  };
  saveCharacterAvatarLibrary(characterId, { ...lib, entries: [...lib.entries, entry] });
  return entry;
}
export function removeCharacterAvatar(characterId: string, avatarId: string): void {
  const lib = readCharacterAvatarLibrary(characterId);
  saveCharacterAvatarLibrary(characterId, {
    ...lib,
    entries: lib.entries.filter(e => e.id !== avatarId),
    activeId: lib.activeId === avatarId ? undefined : lib.activeId,
  });
}
/** The AI can only choose a saved image, never an arbitrary URL from its output. */
export function chooseCharacterAvatar(characterId: string, avatarId: string, autonomous = false, now = Date.now()): string | null {
  const lib = readCharacterAvatarLibrary(characterId);
  if (autonomous && (!lib.autonomousEnabled || (lib.lastChangedAt && now - lib.lastChangedAt < 24 * 60 * 60 * 1000))) return null;
  const entry = lib.entries.find(e => e.id === avatarId);
  if (!entry) return null;
  saveCharacterAvatarLibrary(characterId, { ...lib, activeId: entry.id, lastChangedAt: now });
  return entry.image;
}
export function setAutonomousAvatarEnabled(characterId: string, enabled: boolean): void {
  const lib = readCharacterAvatarLibrary(characterId);
  saveCharacterAvatarLibrary(characterId, { ...lib, autonomousEnabled: enabled });
}

/** Notify mounted private-chat and character-phone surfaces after an avatar selection. */
export const CHARACTER_AVATAR_CHANGED = 'sully:character-avatar-changed';
export function notifyCharacterAvatarChanged(characterId: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHARACTER_AVATAR_CHANGED, { detail: { characterId } }));
}
/** Select an existing library image and broadcast. Caller may additionally persist to CharacterProfile.avatar. */
export function activateCharacterAvatar(characterId: string, avatarId: string, autonomous = false): string | null {
  const image = chooseCharacterAvatar(characterId, avatarId, autonomous);
  if (image) notifyCharacterAvatarChanged(characterId);
  return image;
}
