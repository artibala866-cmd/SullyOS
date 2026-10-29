import { describe, expect, it, vi } from 'vitest';
import { cachedCall, clearAll, invalidate } from './musicCache';

const local = () => vi.stubGlobal('localStorage', {
  getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

describe('网易云播放链接缓存与快速重试', () => {
  it('废弃的在途请求不能挡住新请求，也不能覆盖新播放 URL', async () => {
    local();
    clearAll();
    const stale = deferred<{ data: { url: string }[] }>();
    const key = { ids: [970101], level: 'standard' };
    const first = cachedCall('/song/url', key, '', () => stale.promise);
    // Explicit retry invalidates both MEM and INFLIGHT.
    invalidate('/song/url', '');
    const newer = vi.fn().mockResolvedValue({ data: [{ url: 'https://cdn.example/new.mp3' }] });
    const fresh = await cachedCall('/song/url', key, '', newer);
    expect(fresh.data[0].url).toContain('new.mp3');
    expect(newer).toHaveBeenCalledOnce();
    stale.resolve({ data: [{ url: 'https://cdn.example/expired.mp3' }] });
    expect((await first).data[0].url).toContain('expired.mp3');
    const cached = await cachedCall('/song/url', key, '', newer);
    expect(cached.data[0].url).toContain('new.mp3');
    expect(newer).toHaveBeenCalledOnce();
    clearAll();
    vi.unstubAllGlobals();
  });

  it('无废弃时合并相同参数的并发请求', async () => {
    local();
    clearAll();
    const wait = deferred<{ data: { url: string }[] }>();
    const doCall = vi.fn(() => wait.promise);
    const a = cachedCall('/song/url', {ids:[970102]}, '', doCall);
    const b = cachedCall('/song/url', {ids:[970102]}, '', doCall);
    wait.resolve({data:[{url:'https://cdn.example/ok.mp3'}]});
    expect(await a).toEqual(await b);
    expect(doCall).toHaveBeenCalledOnce();
    clearAll();
    vi.unstubAllGlobals();
  });

  it('Worker HTTP 200 但返回空 URL 不得缓存，下一次必须重新请求', async () => {
    local();
    clearAll();
    const key = {ids:[970104],level:'standard'};
    const doCall = vi.fn()
      .mockResolvedValueOnce({code:200,data:[{url:null}]})
      .mockResolvedValueOnce({code:200,data:[{url:'https://cdn.example/recovered.mp3'}]});
    const first = await cachedCall('/song/url',key,'',doCall);
    expect(first.data[0].url).toBeNull();
    const recovered = await cachedCall('/song/url',key,'',doCall);
    expect(recovered.data[0].url).toContain('recovered');
    expect((await cachedCall('/song/url',key,'',doCall)).data[0].url).toContain('recovered');
    expect(doCall).toHaveBeenCalledTimes(2);
    clearAll();
    vi.unstubAllGlobals();
  });

  it('清空全部缓存后，旧请求返回不会重新写入', async () => {
    local();
    clearAll();
    const wait = deferred<{ data: { url: string }[] }>();
    const key = {ids:[970103]};
    const first = cachedCall('/song/url', key, 'session-1', () => wait.promise);
    clearAll();
    wait.resolve({data:[{url:'https://cdn.example/expired.mp3'}]});
    await first;
    const getNew = vi.fn().mockResolvedValue({data:[{url:'https://cdn.example/new.mp3'}]});
    const latest = await cachedCall('/song/url', key, 'session-1', getNew);
    expect(latest.data[0].url).toContain('new.mp3');
    expect(getNew).toHaveBeenCalledOnce();
    clearAll();
    vi.unstubAllGlobals();
  });
});
