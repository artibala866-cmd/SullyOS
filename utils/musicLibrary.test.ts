import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  musicKey, sameMusic, numericMusicId, normalizeTencentSong,
  tencentSearchRows, extractMusicUrl, loadGuestMusicLibrary, persistGuestMusicLibrary,
  upsertLikedSong, recordMusicPlay, validateGuestMusicLibraryBackup, appendGuestMusicPlaylist,
} from './musicLibrary';
import type { Song } from '../context/MusicContext';

const song = (id: number, source?: 'netease' | 'tencent'): Song =>
  ({ id, source, platformId: String(id), name: source || 'old', artists: '', album: '', albumPic: '', duration: 0, fee: 0 });

afterEach(() => vi.unstubAllGlobals());

describe('跨来源音乐身份与旧数据兼容', () => {
  it('旧数字 id 仍然默认网易云，本地与 QQ 不串线', () => {
    expect(musicKey(song(42))).toBe('netease:42');
    expect(musicKey(song(42, 'tencent'))).toBe('tencent:42');
    expect(sameMusic(song(42), song(42, 'tencent'))).toBe(false);
    expect(musicKey({ ...song(42), local: true })).toBe('local:42');
  });
  it('QQ 的 MID 兼容数字 Song.id，不丢失真实平台标识', () => {
    const qq = normalizeTencentSong({ songmid: 'MIDA123', song: '示例', singer: [{ name: '歌手' }] });
    expect(qq).toMatchObject({ source: 'tencent', platformId: 'MIDA123', name: '示例', artists: '歌手' });
    expect(qq?.id).toBe(numericMusicId('MIDA123'));
    expect(musicKey(qq!)).toBe('tencent:MIDA123');
  });
  it('只接受实际音频 URL，并读取常见 QQ 搜索结构', () => {
    expect(tencentSearchRows({ data: { song: { list: [{ id: 1 }] } } })).toHaveLength(1);
    expect(extractMusicUrl({ data: { url: 'http://example.com/play.mp3' } })).toBe('https://example.com/play.mp3');
    expect(extractMusicUrl({ data: { msg: 'denied' } })).toBe('');
  });
  it('从旧喜欢数字 ID 安全迁移，并持久化收藏/历史不互相污染', () => {
    const data = new Map<string, string>([['sully_music_guest_likes_v1', '[42]']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } });
    let lib = loadGuestMusicLibrary();
    expect(lib.likes[0].name).toContain('42');
    lib = { ...lib, likes: upsertLikedSong(lib.likes, song(42, 'tencent')), history: recordMusicPlay(lib.history, song(42)) };
    persistGuestMusicLibrary(lib);
    expect(loadGuestMusicLibrary().likes.map(musicKey)).toEqual(['tencent:42', 'netease:42']);
    expect(loadGuestMusicLibrary().history).toHaveLength(1);
  });
  it('备份数据校验保留 QQ 来源、歌单顺序与本地资源键', () => {
    const a = song(42, 'netease');
    const b = { ...song(42, 'tencent'), mid: 'QQMID42' };
    const local = { ...song(7), local: true, localAssetKey: 'song-blob-7' };
    const payload = {
      likes: [a, b],
      playlists: [{ id: 'pl-1', name: '通勤', songs: [b, local, a], createdAt: 1, updatedAt: 2 }],
      history: [{ song: local, playedAt: 3 }],
    };
    expect(validateGuestMusicLibraryBackup(payload)).toEqual(payload);
    expect(validateGuestMusicLibraryBackup(payload).playlists[0].songs.map(musicKey))
      .toEqual(['tencent:42', 'local:7', 'netease:42']);
  });
  it('导入前拒绝损坏和会被截断的备份，不动原有收藏', () => {
    expect(() => validateGuestMusicLibraryBackup({ likes: [], playlists: [] })).toThrow();
    expect(() => validateGuestMusicLibraryBackup({
      likes: [], playlists: [{ id: 'x', name: '太长', songs: Array(501).fill(song(1)), createdAt: 1, updatedAt: 1 }], history: [],
    })).toThrow(/歌单/);
    expect(() => validateGuestMusicLibraryBackup({
      likes: [ { id: 1, name: 'bad', artists: '', album: '', albumPic: '', duration: NaN, fee: 0 } ],
      playlists: [], history: [],
    })).toThrow();
  });
  it('空间不足不能假装保存成功，旧收藏仍可读取', () => {
    const data = new Map<string, string>([['sully_music_guest_likes_v1', '[12]']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (_key: string, _value: string) => { throw new Error('QuotaExceededError'); },
    });
    expect(persistGuestMusicLibrary({ likes: [song(2)], playlists: [], history: [] })).toBe(false);
    expect(loadGuestMusicLibrary().likes.map(musicKey)).toEqual(['netease:12']);
  });

  it('音乐库完整元数据可 JSON 备份-清空-恢复往返，不复制音频 Blob', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
    });
    const qq = { ...song(42, 'tencent'), mid: 'MID42' };
    const local = { ...song(7), local: true, localAssetKey: 'assets/local-audio-7' };
    const original = {
      likes: [qq, song(42)],
      playlists: [{ id: 'a', name: '周末', songs: [local, qq, song(42)], createdAt: 1, updatedAt: 2 }],
      history: [{ song: qq, playedAt: 13 }, { song: local, playedAt: 12 }],
    };
    expect(persistGuestMusicLibrary(original)).toBe(true);
    const archive = JSON.parse(JSON.stringify({ guestMusicLibrary: loadGuestMusicLibrary() }));
    map.delete('sully_music_guest_library_v1');
    const restored = validateGuestMusicLibraryBackup(archive.guestMusicLibrary);
    expect(persistGuestMusicLibrary(restored)).toBe(true);
    expect(loadGuestMusicLibrary()).toEqual(original);
    expect(loadGuestMusicLibrary().playlists[0].songs.map(musicKey))
      .toEqual(['local:7', 'tencent:42', 'netease:42']);
    expect(JSON.stringify(restored)).toContain('assets/local-audio-7');
    expect(JSON.stringify(restored)).not.toContain('data:audio/');
  });
  it('新备份的空音乐库会覆盖本机旧库，而旧备份缺失字段可以保留现有库', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
    });
    expect(persistGuestMusicLibrary({ likes: [song(42)], playlists: [], history: [] })).toBe(true);
    const oldArchive: { guestMusicLibrary?: unknown } = {};
    if (oldArchive.guestMusicLibrary !== undefined)
      persistGuestMusicLibrary(validateGuestMusicLibraryBackup(oldArchive.guestMusicLibrary));
    expect(loadGuestMusicLibrary().likes).toHaveLength(1);
    expect(persistGuestMusicLibrary(validateGuestMusicLibraryBackup({ likes: [], playlists: [], history: [] }))).toBe(true);
    expect(loadGuestMusicLibrary().likes).toHaveLength(0);
  });

  it('从歌曲创建歌单只生成一次数据快照，第一首歌曲保留来源', () => {
    const base = { likes: [song(1)], playlists: [], history: [] };
    const qq = song(42, 'tencent');
    const created = appendGuestMusicPlaylist(base, '  夜间通勤  ', 'new-playlist', 1234, qq);
    expect(created?.playlists).toEqual([{ id: 'new-playlist', name: '夜间通勤',
      songs: [qq], createdAt: 1234, updatedAt: 1234 }]);
    expect(created?.playlists[0].songs.map(musicKey)).toEqual(['tencent:42']);
    expect(base.playlists).toHaveLength(0);
    expect(created?.likes).toEqual(base.likes);
    expect(appendGuestMusicPlaylist(base, '  ', 'bad', 1234, qq)).toBeNull();
  });
  it('达到歌单数量上限时不新建也不偷偷截断任何歌单', () => {
    const full = { likes: [], history: [],
      playlists: Array.from({ length: 80 }, (_, i) => ({
        id: String(i), name: String(i), songs: [song(i)], createdAt: 1, updatedAt: 1,
      })),
    };
    expect(appendGuestMusicPlaylist(full, '多余', 'extra', 1234, song(42))).toBeNull();
    expect(full.playlists).toHaveLength(80);
  });
  it('原子新建歌单在 localStorage 保存失败时不会留下空歌单', () => {
    const base = { likes: [], history: [], playlists: [] };
    const next = appendGuestMusicPlaylist(base, '现场收藏', 'new', 5, song(91))!;
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(persistGuestMusicLibrary(next)).toBe(false);
    expect(base.playlists).toHaveLength(0);
    expect(next.playlists[0].songs).toHaveLength(1);
  });

});
