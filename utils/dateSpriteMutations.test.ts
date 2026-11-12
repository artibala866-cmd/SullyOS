import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CharacterProfile } from '../types';
import { patchDateSprite, removeDateCustomEmotion } from './dateSpriteMutations';

const makeChar = (): CharacterProfile => ({
  id: 'meet-hero', name: '角色', sprites: { normal: 'old-normal' },
  customDateSprites: ['blush', 'cry'],
  dateSkinSets: [
    { id: 'rain', name: '雨天', sprites: { normal: 'old-rain' } },
    { id: 'sun', name: '晴天', sprites: { normal: 'old-sun' } },
  ],
  activeSkinSetId: 'rain',
} as CharacterProfile);
const apply = (char: CharacterProfile, patch: Partial<CharacterProfile>): CharacterProfile =>
  ({ ...char, ...patch });

describe('Meet setup: unusual but possible rapid-use flows', () => {
  it('rapidly uploads 120 different expressions without overwriting earlier images', () => {
    let char = makeChar();
    for (let i = 0; i < 120; i++) {
      char = apply(char, patchDateSprite(char, 'emotion-' + i, 'blobref:' + i));
    }
    expect(Object.keys(char.sprites || {})).toHaveLength(121);
    for (let i = 0; i < 120; i++) expect(char.sprites?.['emotion-' + i]).toBe('blobref:' + i);
    expect(char.dateSkinSets?.[0].sprites.normal).toBe('old-rain');
  });
  it('two images completing out of order both survive when each writes the latest role', () => {
    let char = makeChar();
    // Both conversions started while the same stale props were on screen.
    const writeHappy = (latest: CharacterProfile) => patchDateSprite(latest, 'happy', 'blobref:happy');
    const writeSad = (latest: CharacterProfile) => patchDateSprite(latest, 'sad', 'blobref:sad');
    char = apply(char, writeSad(char));
    char = apply(char, writeHappy(char));
    expect(char.sprites).toMatchObject({ normal: 'old-normal', happy: 'blobref:happy', sad: 'blobref:sad' });
  });
  it('swaps skin, uploads URLs and files to three targets in mixed order', () => {
    let char = makeChar();
    for (let i = 0; i < 75; i++) {
      const skin = i % 3 === 0 ? null : i % 3 === 1 ? 'rain' : 'sun';
      char = apply(char, patchDateSprite(char, 'e' + i, i % 2 ? 'https://img.example/' + i : 'blobref:' + i, skin));
    }
    expect(char.sprites?.e0).toBe('blobref:0');
    expect(char.dateSkinSets?.[0].sprites.e1).toBe('https://img.example/1');
    expect(char.dateSkinSets?.[1].sprites.e2).toBe('blobref:2');
    expect(char.activeSkinSetId).toBe('rain');
    expect(char.dateSkinSets?.[0].sprites.normal).toBe('old-rain');
    expect(char.dateSkinSets?.[1].sprites.normal).toBe('old-sun');
  });
  it('late image upload after skin deletion never recreates deleted skin', () => {
    let char = makeChar();
    char = apply(char, { dateSkinSets: char.dateSkinSets!.filter(s => s.id !== 'rain'), activeSkinSetId: undefined });
    char = apply(char, patchDateSprite(char, 'happy', 'blobref:late', 'rain'));
    expect(char.dateSkinSets?.map(s => s.id)).toEqual(['sun']);
    expect(char.activeSkinSetId).toBeUndefined();
    expect(char.sprites?.happy).toBeUndefined();
  });
  it('deleting one custom emotion does not roll back other concurrent image edits', () => {
    let char = makeChar();
    char = apply(char, patchDateSprite(char, 'happy', 'blobref:happy'));
    char = apply(char, patchDateSprite(char, 'blush', 'blobref:blush'));
    char = apply(char, removeDateCustomEmotion(char, 'blush'));
    expect(char.customDateSprites).toEqual(['cry']);
    expect(char.sprites?.blush).toBeUndefined();
    expect(char.sprites?.happy).toBe('blobref:happy');
  });
  it('settings wires both file and URL uploads into functional latest-state patches', () => {
    const source = readFileSync(new URL('../components/date/DateSettings.tsx', import.meta.url), 'utf8');
    expect(source).toContain('current => patchDateSprite(current, key, ref, skinId)');
    expect(source).toContain('current => patchDateSprite(current, key, ref)');
    expect(source).toContain('current => patchDateSprite(current, key, url, urlTargetSkinId)');
    expect(source).toContain('current => removeDateCustomEmotion(current, key)');
    expect(source).not.toContain('const newSprites = { ...(char.sprites || {}), [key]: ref }');
    expect(source).not.toContain('id: `skin_${Date.now()}`');
  });
});
