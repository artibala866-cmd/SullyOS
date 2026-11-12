import type { CharacterProfile } from '../types';

/** Merge image uploads against the latest role, not the props captured when an upload began. */
export function patchDateSprite(
  current: CharacterProfile, key: string, ref: string, skinId?: string | null,
): Partial<CharacterProfile> {
  if (skinId) {
    const sets = current.dateSkinSets || [];
    // An upload finishing after the skin was deleted must not resurrect that skin.
    if (!sets.some(s => s.id === skinId)) return {};
    return { dateSkinSets: sets.map(s => s.id === skinId
      ? { ...s, sprites: { ...(s.sprites || {}), [key]: ref } }
      : s) };
  }
  return { sprites: { ...(current.sprites || {}), [key]: ref } };
}

/** Removing an emotion is one atomic character change, including its image. */
export function removeDateCustomEmotion(
  current: CharacterProfile, key: string,
): Partial<CharacterProfile> {
  const sprites = { ...(current.sprites || {}) };
  delete sprites[key];
  return {
    sprites,
    customDateSprites: (current.customDateSprites || []).filter(emotion => emotion !== key),
  };
}
