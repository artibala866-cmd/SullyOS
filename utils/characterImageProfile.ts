/** Character-specific image settings, independent of chat persona and API credentials. */
export const characterImageProfileKey = (id: string) => 'sully_image_character_v1_' + id;

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

export function normalizeCharacterImageProfile(value: unknown): CharacterImageProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Partial<CharacterImageProfile>;
  const text = (entry: unknown) => typeof entry === 'string' ? entry : '';
  return {
    appearance: text(profile.appearance),
    reference: text(profile.reference),
    facePrompt: typeof profile.facePrompt === 'string' ? profile.facePrompt : undefined,
    referenceEnabled: typeof profile.referenceEnabled === 'boolean' ? profile.referenceEnabled : undefined,
    referenceMode: profile.referenceMode === 'identity' || profile.referenceMode === 'composition' ? profile.referenceMode : undefined,
    seed: typeof profile.seed === 'string' ? profile.seed : undefined,
    seedLockEnabled: typeof profile.seedLockEnabled === 'boolean' ? profile.seedLockEnabled : undefined,
    wardrobe: profile.wardrobe && typeof profile.wardrobe === 'object' ? {
      guidance: text(profile.wardrobe.guidance), inventory: text(profile.wardrobe.inventory), avoid: text(profile.wardrobe.avoid),
    } : undefined,
  };
}

export const readCharacterImageProfile = (id: string): CharacterImageProfile => {
  try {
    return normalizeCharacterImageProfile(JSON.parse(localStorage.getItem(characterImageProfileKey(id)) || 'null'))
      ?? { appearance: '', reference: '' };
  } catch { return { appearance: '', reference: '' }; }
};

/** Imported cards and manual editing write to the same native character namespace. */
export const writeCharacterImageProfile = (id: string, profile: CharacterImageProfile): void => {
  if (!id) throw new Error('角色 ID 缺失，无法保存生图设定');
  localStorage.setItem(characterImageProfileKey(id), JSON.stringify(profile));
};

export const clearCharacterImageProfile = (id: string): void => {
  localStorage.removeItem(characterImageProfileKey(id));
};

export type ImageReference = { name: string; value: string; mode?: CharacterImageProfile['referenceMode'] };

/** Apply the saved profiles of the people actually depicted in this scene. */
export function composeCharacterImageScene(scene: string, people: { name: string; profile: CharacterImageProfile }[], tagPrompt = false): {
  profile: CharacterImageProfile; references?: ImageReference[];
} {
  if (people.length === 1) {
    const { profile } = people[0];
    return { profile: { ...profile, appearance: [scene, profile.appearance].filter(Boolean).join(', ') } };
  }
  const describe = (name: string, values: (string | undefined)[]) => {
    const text = values.map(value => value?.trim()).filter(Boolean).join(', ');
    return text && (tagPrompt ? text : `${name}: ${text}`);
  };
  const appearance = [scene, ...people.map(({ name, profile }) => describe(name, [profile.appearance, profile.facePrompt]))]
    .filter(Boolean).join(', ');
  const wardrobe = {
    guidance: people.map(({ name, profile }) => describe(name, [profile.wardrobe?.guidance])).filter(Boolean).join(', '),
    inventory: people.map(({ name, profile }) => describe(name, [profile.wardrobe?.inventory])).filter(Boolean).join(', '),
    avoid: people.map(({ profile }) => profile.wardrobe?.avoid?.trim()).filter(Boolean).join(', '),
  };
  const references = people.flatMap(({ name, profile }) => profile.referenceEnabled !== false && profile.reference.trim()
    ? [{ name, value: profile.reference, mode: profile.referenceMode }]
    : []);
  return { profile: { appearance, reference: '', ...(people.length ? { wardrobe } : {}) }, references: references.length ? references : undefined };
}
