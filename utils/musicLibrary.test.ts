import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  musicKey, sameMusic, numericMusicId, normalizeTencentSong,
  tencentSearchRows, extractMusicUrl, loadGuestMusicLibrary, persistGuestMusicLibrary,
  upsertLikedSong, recordMusicPlay,
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
});
