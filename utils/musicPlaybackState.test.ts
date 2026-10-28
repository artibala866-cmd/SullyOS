import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../context/MusicContext';
import { cachedCall, invalidate } from './musicCache';
import { chooseMusicPlayAction, selectMusicQueueTrack } from './musicPlaybackState';

const song = (id: number, source: Song['source'] = 'netease'): Song => ({
  id, source, platformId: String(id), name: 'Song ' + id, artists: 'Artist',
  album: '', albumPic: '', duration: 100, fee: 0,
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('快速切歌和队列原子性', () => {
  it('同一渲染周期点新歌 A→B，第二首使用追加后的最新队列索引', () => {
    const initial = [song(1), song(2), song(3)];
    const a = selectMusicQueueTrack(initial, song(4));
    const b = selectMusicQueueTrack(a.queue, song(5));
    expect(a.idx).toBe(3);
    expect(b.idx).toBe(4);
    expect(b.queue[b.idx].id).toBe(5);
    expect(initial).toHaveLength(3);
  });
  it('同 ID 的 QQ 和网易云不合并；重复点选不会追加重复歌曲', () => {
    const qq = song(42, 'tencent');
    const first = selectMusicQueueTrack([song(42)], qq);
    expect(first.idx).toBe(1);
    const second = selectMusicQueueTrack(first.queue, qq);
    expect(second.idx).toBe(1);
    expect(second.queue).toHaveLength(2);
  });
  it('歌单起始索引必须指向实际所选歌曲', () => {
    const playlist = [song(11), song(22), song(33)];
    expect(selectMusicQueueTrack([], song(22), {replaceQueue: playlist,startIdx:0}).idx).toBe(1);
  });
});

describe('音频错误与锁屏恢复', () => {
  const state = {srcPresent:true,mediaError:false,paused:true,resolving:false,allowPause:true};
  it('坏链接和空音源必须重新解析；正在解析时不重复发请求', () => {
    expect(chooseMusicPlayAction({...state,srcPresent:false})).toBe('resolve');
    expect(chooseMusicPlayAction({...state,mediaError:true})).toBe('resolve');
    expect(chooseMusicPlayAction({...state,mediaError:true,resolving:true})).toBe('wait');
  });
  it('播放键可暂停，锁屏 Play 不会把播放中的音频暂停', () => {
    expect(chooseMusicPlayAction({...state,paused:false})).toBe('pause');
    expect(chooseMusicPlayAction({...state,paused:false,allowPause:false})).toBe('wait');
    expect(chooseMusicPlayAction(state)).toBe('play');
  });
  it('媒体 error/play 事件触发的状态变化不能把坏 URL 视为正常播放', () => {
    const media = new EventTarget();
    let broken = false; let didStart = false;
    media.addEventListener('error', () => { broken = true; });
    media.addEventListener('play', () => { didStart = !broken; });
    media.dispatchEvent(new Event('error'));
    expect(chooseMusicPlayAction({...state,mediaError:broken})).toBe('resolve');
    media.dispatchEvent(new Event('play'));
    expect(didStart).toBe(false);
    broken = false;
    media.dispatchEvent(new Event('play'));
    expect(didStart).toBe(true);
  });
  it('网易云 90 秒播放 URL 缓存过期后可失效并取得新链接', async () => {
    vi.stubGlobal('localStorage', {getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
    const args = {ids:[894120],level:'standard'};
    const getUrl = vi.fn().mockResolvedValueOnce({data:[{url:'https://x.example/old.mp3'}]})
      .mockResolvedValueOnce({data:[{url:'https://x.example/fresh.mp3'}]});
    const a = await cachedCall('/song/url',args,'music-recovery-test',getUrl);
    const b = await cachedCall('/song/url',args,'music-recovery-test',getUrl);
    expect(b).toEqual(a);
    expect(getUrl).toHaveBeenCalledTimes(1);
    invalidate('/song/url','music-recovery-test');
    const fresh = await cachedCall('/song/url',args,'music-recovery-test',getUrl);
    expect(fresh.data[0].url).toContain('fresh');
    expect(getUrl).toHaveBeenCalledTimes(2);
  });
});
