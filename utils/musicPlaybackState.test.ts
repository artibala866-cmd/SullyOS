import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../context/MusicContext';
import { cachedCall, invalidate } from './musicCache';
import { chooseMusicPlayAction, selectMusicQueueTrack } from './musicPlaybackState';
import { parseCharMusicRequest, findCharMusicTrack, charMusicPlaybackConfirmed, joinCharListeningState, leaveCharListeningState, verifiedCharMusicCardIntent } from './musicCharActions';

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


describe('Char 点歌与收藏不能选错来源或假装播放成功', () => {
  const qq = { ...song(42, 'tencent'), name: '同名歌曲', platformId: 'QQMID42', mid: 'QQMID42' };
  const netease = { ...song(42), name: '同名歌曲' };
  it('显式指定 QQ/网易云会得到相应来源与纯歌名，不混用同 ID', () => {
    const qqRequest = parseCharMusicRequest('QQ音乐：同名歌曲', 'netease');
    const neteaseRequest = parseCharMusicRequest('网易云:同名歌曲', 'tencent');
    expect(qqRequest).toMatchObject({ phrase: '同名歌曲', source: 'tencent', explicit: true });
    expect(neteaseRequest).toMatchObject({ phrase: '同名歌曲', source: 'netease', explicit: true });
    expect(findCharMusicTrack([netease, qq], qqRequest)).toEqual(qq);
    expect(findCharMusicTrack([qq, netease], neteaseRequest)).toEqual(netease);
  });
  it('优先精确匹配，省略平台时沿用当前来源，不让前一首名称包含导致错歌', () => {
    const long = { ...qq, name: '同名歌曲 现场版' };
    const request = parseCharMusicRequest('同名歌曲', 'tencent');
    expect(findCharMusicTrack([long, netease, qq], request)).toEqual(qq);
    expect(findCharMusicTrack([netease, qq], request)).toEqual(qq);
    expect(findCharMusicTrack([netease], parseCharMusicRequest('QQ:同名歌曲'))).toBeUndefined();
  });
  it('仅在同来源同歌曲且真正开始播放时才算 Char 选歌成功', () => {
    expect(charMusicPlaybackConfirmed(qq, qq, true, false, false)).toBe(true);
    expect(charMusicPlaybackConfirmed(qq, netease, true, false, false)).toBe(false);
    expect(charMusicPlaybackConfirmed(qq, qq, false, false, false)).toBe(false);
    expect(charMusicPlaybackConfirmed(qq, qq, true, true, false)).toBe(false);
    expect(charMusicPlaybackConfirmed(qq, qq, true, false, true)).toBe(false);
  });
});

describe('多 Char 伴听即刻生效与独立结束', () => {
  it('接受 A 后马上切歌已具备 A 的有效状态；两人开始时间各自保留', () => {
    const a = joinCharListeningState([], {}, 'A', 1000);
    const b = joinCharListeningState(a.partners, a.startedAt, 'B', 2000);
    expect(a.partners).toEqual(['A']);
    expect(b).toEqual({ partners: ['A','B'], startedAt: { A: 1000, B: 2000 } });
    const again = joinCharListeningState(b.partners, b.startedAt, 'A', 3000);
    expect(again.startedAt.A).toBe(1000);
  });
  it('A 结束后不能继续选歌，不会误删 B 的伴听状态', () => {
    const both = joinCharListeningState(['A'], { A: 1000 }, 'B', 2000);
    const left = leaveCharListeningState(both.partners, both.startedAt, 'A');
    expect(left).toEqual({ partners: ['B'], startedAt: { B: 2000 } });
    expect(both.partners).toEqual(['A', 'B']);
    expect(leaveCharListeningState(left.partners, left.startedAt, 'B')).toEqual({ partners: [], startedAt: {} });
  });
});

describe('Char 收藏失败不得伪造成功音乐卡片', () => {
  it('仅保存成功才能生成 add 卡片；join_and_add 保存失败退回单纯一起听', () => {
    expect(verifiedCharMusicCardIntent('add', false)).toBeNull();
    expect(verifiedCharMusicCardIntent('join_and_add', false)).toBe('join');
    expect(verifiedCharMusicCardIntent('join_and_add', true)).toBe('join_and_add');
    expect(verifiedCharMusicCardIntent('add', true)).toBe('add');
    expect(verifiedCharMusicCardIntent('join', true)).toBe('join');
    expect(verifiedCharMusicCardIntent('join', true, false)).toBeNull();
    expect(verifiedCharMusicCardIntent('join_and_add', true, false)).toBe('add');
    expect(verifiedCharMusicCardIntent('join_and_add', false, false)).toBeNull();
  });
});
