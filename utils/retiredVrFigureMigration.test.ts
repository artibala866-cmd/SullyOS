import { describe, expect, it } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { migrateRetiredVrCharacterFigure, migrateRetiredVrUserFigure } from './retiredVrFigureMigration';

const character = (other: Record<string, unknown> = {}): CharacterProfile => ({
  id: 'char-1', name: 'Test', ...other,
} as unknown as CharacterProfile);
const user = (other: Record<string, unknown> = {}): UserProfile => ({
  name: 'User', avatar: '', bio: '', ...other,
} as UserProfile);

describe('retired 彼方 figure migration', () => {
  it('copies a user-created Chibi to the independent user figure slot', () => {
    const input = user({ vrState: { enabled: true, chibi: { state: { hair: 1 }, img: 'data:image/png;base64,YQ==' } } });
    const result = migrateRetiredVrUserFigure(input);
    expect(result.changed).toBe(true);
    expect(result.value.chibiStudio?.userChibi).toEqual({ state: { hair: 1 }, img: 'data:image/png;base64,YQ==' });
    expect(result.value.vrState).toEqual(input.vrState); // Never destroy legacy data during migration.
    expect(migrateRetiredVrUserFigure(result.value).changed).toBe(false);
  });

  it('never overwrites a newer user figure or copies a remote authored image', () => {
    const preserved = user({ chibiStudio: { userChibi: { state: { hair: 2 } } }, vrState: { chibi: { state: { hair: 1 } } } });
    expect(migrateRetiredVrUserFigure(preserved)).toEqual({ value: preserved, changed: false });
    const remote = user({ vrState: { chibi: { img: 'https://example.org/old-author-art.png' } } });
    expect(migrateRetiredVrUserFigure(remote).changed).toBe(false);
  });

  it('preserves 3D home outfit and current room figure while migrating editable legacy state', () => {
    const existing = character({
      chibiStudio: { home3D: { state: { outfit: 'saved' }, hair: {} }, room: { state: { outfit: 'room' } } },
      sprites: { chibi: 'blobref:existing' },
      vrState: { chibi: { state: { outfit: 'old' }, img: 'data:image/png;base64,YQ==' } },
    });
    expect(migrateRetiredVrCharacterFigure(existing)).toEqual({ value: existing, changed: false });
    const legacy = character({ vrState: { chibi: { state: { outfit: 'my-figure' }, img: 'blobref:local' } } });
    const result = migrateRetiredVrCharacterFigure(legacy);
    expect(result.value.chibiStudio?.room?.state).toEqual({ outfit: 'my-figure' });
    expect(result.value.sprites?.chibi).toBe('blobref:local');
    expect(result.value.vrState).toEqual(legacy.vrState);
    expect(migrateRetiredVrCharacterFigure(result.value).changed).toBe(false);
  });

  it('does not migrate an authored remote image to the character sprites', () => {
    const remote = character({ vrState: { chibi: { img: 'https://example.org/old-author-art.png' } } });
    expect(migrateRetiredVrCharacterFigure(remote).changed).toBe(false);
  });
});
