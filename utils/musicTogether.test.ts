/**
 * 一起听依赖的免登录搜索、音源与歌词回退。
 * 防止将网易云登录意外变成播放门槛。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { musicApi, type MusicCfg } from '../context/MusicContext';

const guestCfg: MusicCfg = { workerUrl: '', cookie: '', quality: 'standard' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('免登录音乐回退', () => {
  it('Worker 不可用时仍能搜索真实歌曲', async () => {
    vi.spyOn(musicApi, 'call').mockRejectedValue(new Error('Worker offline'));
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify([{
        id: 123, name: 'Example Track', artist: ['An Artist'], album: 'An Album', duration: 210,
      }]), { status: 200 });
    }));
    const result = await musicApi.search(guestCfg, 'Example Track');
    expect(result.result.songs[0]).toMatchObject({
      id: 123, name: 'Example Track', ar: [{ name: 'An Artist' }], dt: 210000,
    });
    expect(calls[0]).toContain('types=search');
    expect(calls[0]).toContain('source=netease');
  });

  it('没有网易云 Cookie 也能取得备用音源', async () => {
    vi.spyOn(musicApi, 'call').mockRejectedValue(new Error('Worker offline'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://example.com/track.mp3',
    }), { status: 200 })));
    const result = await musicApi.songUrl(guestCfg, 123);
    expect(result.data[0].url).toBe('https://example.com/track.mp3');
  });

  it('备用歌词使用播放器原有格式', async () => {
    vi.spyOn(musicApi, 'call').mockRejectedValue(new Error('Worker offline'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      lyric: '[00:01.00]Test', tlyric: '[00:01.00]测试',
    }), { status: 200 })));
    const result = await musicApi.lyric(guestCfg, 123);
    expect(result.lrc.lyric).toContain('Test');
    expect(result.tlyric.lyric).toContain('测试');
  });

  it('原歌词存在时不重复请求备用服务', async () => {
    vi.spyOn(musicApi, 'call').mockResolvedValue({ lrc: { lyric: '[00:01.00]Original' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await musicApi.lyric(guestCfg, 123);
    expect(result.lrc.lyric).toContain('Original');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
