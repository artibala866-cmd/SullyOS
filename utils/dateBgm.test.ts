import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../context/MusicContext';
import { loadGuestMusicLibrary, persistGuestMusicLibrary, validateGuestMusicLibraryBackup, musicKey } from './musicLibrary';
import {
  findCharacterDateBgm, createDateBgmList, renameDateBgmList, deleteDateBgmList, bindDateBgmCharacter,
  addDateBgmSong, removeDateBgmSong, moveDateBgmSong, dateBgmLists,
} from './dateBgm';

const mkSong = (id: number, source: 'tencent' | 'netease' = 'netease'): Song => ({
  id, source, platformId: String(id), name: `S${id}`, artists: 'a', album: '', albumPic: '', duration: 180, fee: 0,
});
const blank = () => ({ likes: [mkSong(6)], playlists: [], history: [] });
const create = (name = '初见') => createDateBgmList(blank(), name, 'meet-1', 100)!;

afterEach(() => vi.unstubAllGlobals());

describe('dedicated Meet BGM binding and playback gate', () => {
  it('no BGM config / empty list / unbound character never triggers playback', () => {
    expect(findCharacterDateBgm(blank(), 'a')).toBeNull();
    expect(findCharacterDateBgm(create(), 'a')).toBeNull();
    const bound = bindDateBgmCharacter(create(), 'meet-1', 'a', true)!;
    expect(findCharacterDateBgm(bound, 'a')).toBeNull();
    const filled = addDateBgmSong(create(), 'meet-1', mkSong(42))!;
    expect(findCharacterDateBgm(filled, 'a')).toBeNull();
  });
  it('keeps ordinary playlists intact, plays bound character in stored order only', () => {
    let lib = create();
    lib = bindDateBgmCharacter(lib, 'meet-1', 'a', true)!;
    lib = bindDateBgmCharacter(lib, 'meet-1', 'b', true)!;
    lib = addDateBgmSong(lib, 'meet-1', mkSong(42))!;
    lib = addDateBgmSong(lib, 'meet-1', mkSong(11, 'tencent'))!;
    expect(findCharacterDateBgm(lib, 'a')?.songs.map(musicKey)).toEqual(['netease:42', 'tencent:11']);
    expect(findCharacterDateBgm(lib, 'b')?.songs).toHaveLength(2);
    expect(findCharacterDateBgm(lib, 'c')).toBeNull();
    expect(lib.likes).toEqual(blank().likes);
    expect(lib.playlists).toEqual(blank().playlists);
    lib = moveDateBgmSong(lib, 'meet-1', 1, 0)!;
    expect(findCharacterDateBgm(lib, 'a')?.songs[0].source).toBe('tencent');
    lib = removeDateBgmSong(lib, 'meet-1', 'tencent:11')!;
    expect(findCharacterDateBgm(lib, 'a')?.songs.map(musicKey)).toEqual(['netease:42']);
    lib = deleteDateBgmList(lib, 'meet-1')!;
    expect(findCharacterDateBgm(lib, 'a')).toBeNull();
  });
  it('character rebinding is exclusive; wrong or deleted ids do not erase another playlist', () => {
    let lib = create();
    lib = createDateBgmList(lib, '夜间', 'meet-2', 101)!;
    lib = bindDateBgmCharacter(lib, 'meet-1', 'a', true)!;
    lib = bindDateBgmCharacter(lib, 'meet-2', 'a', true)!;
    expect(dateBgmLists(lib)[0].characterIds).toEqual([]);
    expect(dateBgmLists(lib)[1].characterIds).toEqual(['a']);
    expect(bindDateBgmCharacter(lib, 'missing', 'a', true)).toBeNull();
    lib = bindDateBgmCharacter(lib, 'meet-2', 'a', false)!;
    expect(dateBgmLists(lib)[1].characterIds).toEqual([]);
    expect(renameDateBgmList(lib, 'meet-2', '雨天')?.dateBgmPlaylists?.[1].name).toBe('雨天');
  });
  it('source-aware dedup prevents same song duplicate, but keeps QQ and NetEase distinct', () => {
    let lib = create();
    lib = addDateBgmSong(lib, 'meet-1', mkSong(42))!;
    lib = addDateBgmSong(lib, 'meet-1', mkSong(42))!;
    lib = addDateBgmSong(lib, 'meet-1', mkSong(42, 'tencent'))!;
    expect(dateBgmLists(lib)[0].songs.map(musicKey)).toEqual(['netease:42', 'tencent:42']);
    expect(createDateBgmList(lib, '  ', 'bad', 9)).toBeNull();
    expect(moveDateBgmSong(lib, 'meet-1', -1, 0)).toBeNull();
  });
  it('round-trips separate BGM playlists in the real music library and backup; old format remains compatible', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    let lib = create();
    lib = bindDateBgmCharacter(lib, 'meet-1', 'char-11', true)!;
    lib = addDateBgmSong(lib, 'meet-1', mkSong(123, 'tencent'))!;
    expect(persistGuestMusicLibrary(lib)).toBe(true);
    expect(findCharacterDateBgm(loadGuestMusicLibrary(), 'char-11')?.songs.map(musicKey)).toEqual(['tencent:123']);
    const backup = validateGuestMusicLibraryBackup(loadGuestMusicLibrary());
    expect(backup.dateBgmPlaylists?.[0].characterIds).toEqual(['char-11']);
    expect(validateGuestMusicLibraryBackup(blank()).dateBgmPlaylists).toBeUndefined();
    expect(() => validateGuestMusicLibraryBackup({ ...lib, dateBgmPlaylists: [{ ...lib.dateBgmPlaylists![0], songs: [undefined] }] })).toThrow(/BGM/);
  });
});
