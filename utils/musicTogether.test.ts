/**
 * 一起听依赖的免登录搜索、音源与歌词回退。
 * 防止将网易云登录意外变成播放门槛。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { musicApi, shouldRetryMusicMediaError, type MusicCfg } from '../context/MusicContext';

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
  it('代理一直无响应时，会超时切到免登录搜索，不无限转圈', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(musicApi, 'call').mockImplementation(() => new Promise(() => {}));
      const guestFetch = vi.fn(async () => new Response(JSON.stringify([{
        id: 456, name: 'Fallback Song', artist: ['Guest Artist'], duration: 160,
      }]), { status: 200 }));
      vi.stubGlobal('fetch', guestFetch);
      const searching = musicApi.search(guestCfg, 'Fallback Song');
      await vi.advanceTimersByTimeAsync(6001);
      const result = await searching;
      expect(result.result.songs[0].name).toBe('Fallback Song');
      expect(guestFetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });


  it('QQ Music 搜索使用真实 QQ 路径，不返回网易云冒充', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: { song: { list: [
        { songid: 123, songmid: 'QQMID123', song: 'QQ song', singer: [{ name: 'QQ singer' }] },
      ] } } }), { status: 200 });
    }));
    const songs = await musicApi.searchTencent('QQ song');
    expect(songs[0]).toMatchObject({ source: 'tencent', platformId: '123', mid: 'QQMID123', name: 'QQ song' });
    expect(urls[0]).toContain('/tencent/search/song');
    expect(urls[0]).toContain('word=QQ+song');
  });

  it('QQ Music 播放地址使用 QQ MID，不调用网易云 URL 接口', async () => {
    const urls: string[] = [];
    vi.spyOn(musicApi, 'songUrl').mockImplementation(() => { throw Error('NetEase URL must not be used'); });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ data: { url: 'https://example.com/qq.mp3' } }), { status: 200 });
    }));
    const result = await musicApi.songUrlFor(guestCfg, {
      id: 123, source: 'tencent', platformId: '123', mid: 'QQMID123',
      name: 'QQ', artists: 'A', album: '', albumPic: '', duration: 100, fee: 0,
    });
    expect(result.data[0].url).toBe('https://example.com/qq.mp3');
    expect(urls[0]).toContain('mid=QQMID123');
    expect(urls[0]).not.toContain('/netease/');
  });

  it('QQ 备用解析失败不跨平台冒用网易云歌曲', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ url: null }), { status: 200 });
    }));
    const result = await musicApi.songUrlFor(guestCfg, {
      id: 123, source: 'tencent', platformId: '123',
      name: 'QQ', artists: 'A', album: '', albumPic: '', duration: 100, fee: 0,
    });
    expect(result.data[0].url).toBeNull();
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('source=tencent');
  });

  it('坏掉的远程音频链接同来源最多自动重试一次', () => {
    expect(shouldRetryMusicMediaError(2, false, false)).toBe(true);
    expect(shouldRetryMusicMediaError(4, false, false)).toBe(true);
    expect(shouldRetryMusicMediaError(4, false, true)).toBe(false);
    expect(shouldRetryMusicMediaError(2, true, false)).toBe(false);
    expect(shouldRetryMusicMediaError(3, false, false)).toBe(false);
    expect(shouldRetryMusicMediaError(undefined, false, false)).toBe(false);
  });

});
