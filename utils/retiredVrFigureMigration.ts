import type { CharacterProfile, UserProfile } from '../types';

/**
 * One-way, non-destructive migration of user-created figure assets away from the retired
 * 彼方 feature. Do not copy external URLs: old scripted/NPC artwork is not ours to reuse.
 * Legacy fields remain untouched until backup/read compatibility is verified.
 */
const ownedImage = (value: unknown): value is string =>
  typeof value === 'string' && (/^data:image\//i.test(value) || value.startsWith('blobref:'));

export function migrateRetiredVrUserFigure(user: UserProfile): { value: UserProfile; changed: boolean } {
  if (user.chibiStudio?.userChibi?.state || user.chibiStudio?.userChibi?.img) return { value: user, changed: false };
  const source = user.vrState?.chibi;
  if (!source?.state && !ownedImage(source?.img)) return { value: user, changed: false };
  return {
    value: {
      ...user,
      chibiStudio: {
        ...user.chibiStudio,
        userChibi: {
          ...(source.state ? { state: source.state } : {}),
          ...(ownedImage(source.img) ? { img: source.img } : {}),
        },
      },
    },
    changed: true,
  };
}

export function migrateRetiredVrCharacterFigure(char: CharacterProfile): { value: CharacterProfile; changed: boolean } {
  const sourceState = char.chibiStudio?.vr?.state ?? char.vrState?.chibi?.state;
  const sourceImage = char.vrState?.chibi?.img;
  const migrateState = !char.chibiStudio?.room?.state && !!sourceState;
  const migrateImage = !char.sprites?.chibi && ownedImage(sourceImage);
  if (!migrateState && !migrateImage) return { value: char, changed: false };
  return {
    value: {
      ...char,
      ...(migrateImage ? { sprites: { ...char.sprites, chibi: sourceImage } } : {}),
      ...(migrateState ? {
        chibiStudio: {
          ...char.chibiStudio,
          room: { ...char.chibiStudio?.room, state: sourceState },
        },
      } : {}),
    },
    changed: true,
  };
}
