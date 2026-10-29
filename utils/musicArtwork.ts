/**
 * GD Studio pictures require a separate JSON {url} request when search only
 * returns pic_id. Lazy callers + a conservative global budget protect the
 * upstream 50 requests / 5 minutes limit and Android WebView scrolling.
 */
type MusicCover = { albumPic?: string; picId?: string; source?: 'netease' | 'tencent' };
const cached = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string>>();
let windowStart = 0, requestsInWindow = 0;
// A provider-level 403/429 applies to every cover, not just one pic_id.
// Back off globally instead of hammering the same blocked GD endpoint.
let providerBlockedUntil = 0;
const MAX_COVER_CALLS_PER_5_MIN = 18;

export const getGuestMusicCover = async (song: MusicCover): Promise<string> => {
  if (song.albumPic && /^https?:\/\//i.test(song.albumPic)) return song.albumPic.replace(/^http:\/\//i, 'https://');
  if (!song.picId || !String(song.picId).trim()) return '';
  const key = `${song.source === 'tencent' ? 'tencent' : 'netease'}:${song.picId}`;
  const now = Date.now();
  const hit = cached.get(key);
  if (hit && hit.expires > now) return hit.url;
  if (inflight.has(key)) return inflight.get(key)!;
  if (now < providerBlockedUntil) return '';
  if (now - windowStart > 300000) { windowStart = now; requestsInWindow = 0; }
  if (requestsInWindow >= MAX_COVER_CALLS_PER_5_MIN) return '';
  requestsInWindow++;
  const request = (async (): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const url = new URL('https://music-api.gdstudio.xyz/api.php');
      for (const [k, v] of Object.entries({
        types: 'pic', source: song.source === 'tencent' ? 'tencent' : 'netease',
        id: String(song.picId), size: '300',
      })) url.searchParams.set(k, v);
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status))
          providerBlockedUntil = Date.now() + 5 * 60 * 1000;
        else if (response.status >= 500)
          providerBlockedUntil = Date.now() + 30 * 1000;
        cached.set(key, { url: '', expires: Date.now() + 60 * 1000 });
        return '';
      }
      const body = await response.json();
      const image = typeof body?.url === 'string' && /^https?:\/\//i.test(body.url)
        ? body.url.replace(/^http:\/\//i, 'https://') : '';
      cached.set(key, { url: image, expires: Date.now() + (image ? 30 * 60000 : 60000) });
      return image;
    } catch {
      cached.set(key, { url: '', expires: Date.now() + 60000 });
      return '';
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return request;
};

/** Reset for tests and when a configured music provider is changed. */
export const clearGuestMusicCoverCache = () => {
  cached.clear();
  inflight.clear();
  windowStart = 0;
  requestsInWindow = 0;
  providerBlockedUntil = 0;
};
