import { afterEach, describe, expect, it, vi } from 'vitest';
import { actualMusicQualityLabel, gdMusicBitrate, guestMusicErrorText,
  guestMusicIsTransient, retryGuestMusicOnce, createNeteaseGuestCircuit, validateNeteaseGuestStatus } from './musicSourceHealth';
import { clearGuestMusicCoverCache, getGuestMusicCover } from './musicArtwork';

afterEach(() => {
  clearGuestMusicCoverCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('QQ 音源临时 API 失效', () => {
  it('HTTP 200 但返回 API 已失效时，只重试一次，后续成功无需退出音乐 App', async () => {
    const request = vi.fn().mockResolvedValueOnce({code: 500, msg: 'API 已失效，请稍后重试'})
      .mockResolvedValueOnce({data: {url: 'https://music.example/fresh.mp3'}});
    const found = await retryGuestMusicOnce<any>(request, (v: any) => !!v.data?.url);
    expect(found.data.url).toContain('fresh.mp3');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('未知的版权或空响应不进入无限重试', async () => {
    const request = vi.fn().mockResolvedValue({data: {url: null}, code: 404, message: '版权限制'});
    expect(await retryGuestMusicOnce<any>(request, (v: any) => !!v.data?.url)).toMatchObject({code: 404});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('超时不会立即再次阻塞 5 秒；429 等快速错误重试一次', async () => {
    const timeout = vi.fn().mockRejectedValue(new Error('音源服务响应超时'));
    await expect(retryGuestMusicOnce<any>(timeout, () => true)).rejects.toThrow('超时');
    expect(timeout).toHaveBeenCalledOnce();
    const throttled = vi.fn().mockRejectedValueOnce(new Error('HTTP 503'))
      .mockResolvedValueOnce({url: 'https://example.com/fresh.mp3'});
    expect(await retryGuestMusicOnce<any>(throttled, (res: any) => !!res.url)).toHaveProperty('url');
    expect(throttled).toHaveBeenCalledTimes(2);
  });
  it('HTTP 401/403/404 即使错误文字带 API 也不能重试', async () => {
    expect(guestMusicIsTransient('QQ 音乐播放解析接口不可用（HTTP 403）')).toBe(false);
    expect(guestMusicIsTransient('QQ API error HTTP 404')).toBe(false);
    expect(guestMusicIsTransient({code: 403, msg: 'API 暂时失效'})).toBe(false);
    expect(guestMusicIsTransient({code: 404, message: '稍后重试'})).toBe(false);
    expect(guestMusicIsTransient({code: 429, message: '限流'})).toBe(true);
    expect(guestMusicIsTransient({code: 503})).toBe(true);
    const denied = vi.fn().mockRejectedValue(new Error('QQ API（HTTP 403）'));
    await expect(retryGuestMusicOnce<any>(denied, () => true)).rejects.toThrow('403');
    expect(denied).toHaveBeenCalledOnce();
    const payload = vi.fn().mockResolvedValue({code:403, msg:'API 过期', data:{url:null}});
    expect(await retryGuestMusicOnce<any>(payload, (v: any) => !!v.data?.url)).toMatchObject({code:403});
    expect(payload).toHaveBeenCalledOnce();
  });

  it('能识别第三方 message/msg/error，避免把接口故障误判为版权问题', () => {
    expect(guestMusicErrorText({code:503, data:{message:'接口维护'}})).toContain('接口维护');
    expect(guestMusicIsTransient('API 已失效')).toBe(true);
    expect(guestMusicIsTransient('版权限制')).toBe(false);
  });
});

describe('网易云与 QQ 音质真实性', () => {
  it('GD 备用请求不再固定 128，用户音质档位映射正确', () => {
    expect(['standard','higher','exhigh','lossless','hires'].map(gdMusicBitrate))
      .toEqual(['128','192','320','740','999']);
  });
  it('QQ 未返回真实码率时不能冒称 Hi-Res；有报告时显示来源值', () => {
    expect(actualMusicQualityLabel('tencent', null)).toContain('未知');
    expect(actualMusicQualityLabel('netease', 320000)).toContain('320 kbps');
    expect(actualMusicQualityLabel('netease', 320, 'gdstudio')).toContain('320 kbps');
    expect(actualMusicQualityLabel('tencent', 999, 'gdstudio')).toContain('未验证');
    expect(actualMusicQualityLabel('local', null)).toContain('本地文件');
  });
});

describe('pic_id 封面限流与懒加载基础', () => {
  it('只有 pic_id 才用 GD 的 types=pic JSON 解析；同封面并发合并', async () => {
    const url: string[] = [];
    const fetchMock = vi.fn(async (request: string) => {
      url.push(String(request));
      return new Response(JSON.stringify({url:'https://art.example/cover.jpg'}), {status:200});
    });
    vi.stubGlobal('fetch', fetchMock);
    const cover = {picId:'ABC',source:'netease' as const};
    const [a,b] = await Promise.all([getGuestMusicCover(cover), getGuestMusicCover(cover)]);
    expect(a).toBe('https://art.example/cover.jpg');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url[0]).toContain('types=pic');
    expect(url[0]).toContain('id=ABC');
  });
  it('已有封面不请求额外接口，缺失 ID 也不占用流量', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await getGuestMusicCover({albumPic:'http://x.example/p.png',picId:'X'}))
      .toBe('https://x.example/p.png');
    expect(await getGuestMusicCover({albumPic:'',picId:''})).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('GD 整站 403 后不继续请求其他封面，避免被限流时反复撞接口', async () => {
    const fetchMock = vi.fn(async () => new Response('', {status:403}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getGuestMusicCover({picId:'blocked-1'})).toBe('');
    expect(await getGuestMusicCover({picId:'blocked-2'})).toBe('');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('一口气打开 50 首无封面的歌也不会超过保护预算', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({url:''}), {status:200}));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all(Array.from({length:50}, (_,i) => getGuestMusicCover({picId:String(i)})));
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(18);
  });
});

describe('网易云备用源限流和业务失败判定', () => {
  it('401/403/429 触发短时熔断，冷却结束恢复；404 单曲故障不封整个服务', () => {
    const gate = createNeteaseGuestCircuit();
    gate.noteFailure(new Error('服务不可用（HTTP 403）'), 1000);
    expect(gate.remainingMs(2000)).toBe(299000);
    expect(() => gate.assertAvailable(2000)).toThrow('冷却');
    expect(() => gate.assertAvailable(301001)).not.toThrow();
    gate.noteFailure(new Error('歌曲不存在（HTTP 404）'), 500000);
    expect(gate.remainingMs(500000)).toBe(0);
    gate.noteFailure(new Error('接口（业务状态 429）'), 500000);
    expect(gate.remainingMs(500001)).toBeGreaterThan(0);
    gate.noteSuccess();
    expect(() => gate.assertAvailable(500001)).not.toThrow();
  });
  it('上游 5xx 限制 30 秒、网络异常 20 秒；不保存 cookie 或歌曲 ID', () => {
    const gate = createNeteaseGuestCircuit();
    gate.noteFailure(new Error('HTTP 503'), 10000);
    expect(gate.remainingMs(10000)).toBe(30000);
    gate.reset();
    gate.noteFailure(new Error('Failed to fetch'), 20000);
    expect(gate.remainingMs(20000)).toBe(20000);
    expect(gate.remainingMs(40001)).toBe(0);
  });
  it('HTTP 200 内部的 403/500 不是合法歌词、歌曲列表或空结果', () => {
    expect(() => validateNeteaseGuestStatus({code:403, lyric:''}, '歌词')).toThrow('业务状态 403');
    expect(() => validateNeteaseGuestStatus({code:500, url:null}, '解析')).toThrow('业务状态 500');
    expect(() => validateNeteaseGuestStatus({code:200, lyric:''}, '歌词')).not.toThrow();
    expect(() => validateNeteaseGuestStatus([{id:1}], '搜索')).not.toThrow();
  });
});
