/** Character-specific image settings, independent of chat persona and API credentials. */
const key = (id: string) => 'sully_image_character_v1_' + id;

export type CharacterImageProfile = {
  appearance: string;
  reference: string;
  facePrompt?: string;
  referenceEnabled?: boolean;
  referenceMode?: 'identity' | 'composition';
  seed?: string;
  seedLockEnabled?: boolean;
  wardrobe?: { guidance: string; inventory: string; avoid: string };
};

export const readCharacterImageProfile = (id: string): CharacterImageProfile => {
  try { return { appearance: '', reference: '', ...JSON.parse(localStorage.getItem(key(id)) || '{}') }; }
  catch { return { appearance: '', reference: '' }; }
};

/** Imported cards and manual editing write to the same native character namespace. */
export const writeCharacterImageProfile = (id: string, profile: CharacterImageProfile): void => {
  if (!id) throw new Error('角色 ID 缺失，无法保存生图设定');
  localStorage.setItem(key(id), JSON.stringify(profile));
};

export const clearCharacterImageProfile = (id: string): void => {
  localStorage.removeItem(key(id));
};
