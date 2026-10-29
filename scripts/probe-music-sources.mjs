/**
 * Read-only, anonymous third-party music-source smoke probe.
 * Searches public metadata and inspects URL/cover/lyric response shapes;
 * NEVER downloads or plays audio, sends user cookies, or logs signed URLs.
 * Failures are diagnostic (non-blocking): an upstream outage cannot fail CI.
 */
const deadlineMs = 6500;
const probe = async (label, url, init = {}) => {
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(deadlineMs) });
    const type = response.headers.get('content-type') || '';
    const allow = response.headers.get('access-control-allow-origin');
    const obj = /json/i.test(type) ? await response.json().catch(() => null) : null;
    const summary = {
      source: label,
      http: response.status,
      latencyMs: Date.now() - started,
      json: !!obj,
      cors: allow || '(none)',
      providerCode: typeof obj?.code === 'number' ? obj.code : undefined,
    };
    console.log('MUSIC_SOURCE_PROBE', JSON.stringify(summary));
    return obj;
  } catch (error) {
    console.log('MUSIC_SOURCE_PROBE', JSON.stringify({
      source: label, http: 'unreachable', latencyMs: Date.now()-started,
      reason: error?.name === 'TimeoutError' ? 'timeout' : 'request failed',
    }));
    return null;
  }
};

const gd = (params) => {
  const url = new URL('https://music-api.gdstudio.xyz/api.php');
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,String(value)));
  return url;
};

const qqSearch = new URL('https://api.vkeys.cn/v2/music/tencent/search/song');
qqSearch.searchParams.set('word','钢琴');
qqSearch.searchParams.set('page','1');
qqSearch.searchParams.set('num','2');

// Anonymous, read-only diagnostics against the configured default public
// proxy. No cookies, user data, audio downloads or signed URL values logged.
const workerSearch = new URL('https://proxy.friedsully.com/netease/search');
const workerRequest = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const [qq, netease, worker] = await Promise.all([
  probe('qq_search_vkeys',qqSearch),
  probe('netease_search_gd',gd({types:'search',source:'netease',name:'钢琴',count:2,pages:1})),
  probe('netease_search_worker', workerSearch, workerRequest({keyword:'钢琴',limit:2,offset:0,type:1})),
]);
const keys = value => value && typeof value === 'object' ? Object.keys(value).slice(0,12) : [];
// Structural diagnostics only. Do not expose track titles, IDs or signed URLs.
console.log('MUSIC_SOURCE_SHAPE', JSON.stringify({
  source:'qq_search_vkeys',
  rootKeys:keys(qq),
  dataType:Array.isArray(qq?.data) ? 'array' : typeof qq?.data,
  dataKeys:keys(qq?.data),
  songKeys:keys(qq?.data?.song),
  providerMessage:typeof (qq?.message || qq?.msg) === 'string' ? String(qq.message || qq.msg).slice(0,80) : undefined,
}));
const qqRows = Array.isArray(qq?.data) ? qq.data
  : qq?.data?.song?.list || qq?.data?.list || qq?.data?.songs || qq?.data?.song ||
    qq?.data?.results || qq?.data?.records || qq?.list || [];
if (Array.isArray(qqRows) && qqRows.length) {
  const first = qqRows[0];
  const mid = String(first?.songmid || first?.mid || '');
  const id = String(first?.songid || first?.id || '');
  if (mid || id) {
    const url = new URL('https://api.vkeys.cn/v2/music/tencent/geturl');
    url.searchParams.set(mid ? 'mid' : 'id', mid || id);
    url.searchParams.set('quality','8');
    const resp = await probe('qq_url_vkeys',url);
    console.log('MUSIC_SOURCE_SHAPE', JSON.stringify({
      source:'qq_url_vkeys', hasUrl: !!(resp?.data?.url || resp?.url), errorFlag: !!(resp?.error || resp?.msg),
    }));
    // Metadata-only probe: do not print lyric text, IDs or signed URLs.
    const lyricUrl = new URL('https://api.vkeys.cn/v2/music/tencent/lyric');
    lyricUrl.searchParams.set(mid ? 'mid' : 'id', mid || id);
    const lyrics = await probe('qq_lyric_vkeys', lyricUrl);
    console.log('MUSIC_SOURCE_SHAPE', JSON.stringify({
      source: 'qq_lyric_vkeys',
      hasLrc: typeof (lyrics?.data?.lrc ?? lyrics?.data?.lyric) === 'string',
      hasTranslation: typeof (lyrics?.data?.tlyric ?? lyrics?.data?.trans) === 'string',
      successCode: lyrics?.code === 200,
    }));
  }
}
// Only inspect response shapes from the SAME NetEase platform and the
// public Worker; do not print titles or identifiers.
const workerSongs = Array.isArray(worker?.result?.songs) ? worker.result.songs : [];
console.log('MUSIC_SOURCE_SHAPE', JSON.stringify({
  source:'netease_search_worker', validSongs:workerSongs.length>0,
  successCode:worker?.code === 200,
}));
const workerSongId = Number(workerSongs[0]?.id);
if (Number.isSafeInteger(workerSongId) && workerSongId > 0) {
  const [track, lyrics] = await Promise.all([
    probe('netease_url_worker', 'https://proxy.friedsully.com/netease/song/url',
      workerRequest({ids:[workerSongId],level:'standard'})),
    probe('netease_lyric_worker', 'https://proxy.friedsully.com/netease/lyric',
      workerRequest({id:workerSongId})),
  ]);
  console.log('MUSIC_SOURCE_SHAPE',JSON.stringify({
    source:'netease_url_worker', hasUrl:typeof track?.data?.[0]?.url==='string' && track.data[0].url.startsWith('http'),
    providerCode:track?.code,
  }));
  console.log('MUSIC_SOURCE_SHAPE',JSON.stringify({
    source:'netease_lyric_worker', hasLyrics:typeof lyrics?.lrc?.lyric==='string',
    instrumental:lyrics?.nolyric === true, providerCode:lyrics?.code,
  }));
}
if (Array.isArray(netease) && netease.length) {
  const first = netease[0], id = first?.id;
  if (id != null) {
    const url = await probe('netease_url_gd',gd({types:'url',source:'netease',id,br:128}));
    console.log('MUSIC_SOURCE_SHAPE',JSON.stringify({source:'netease_url_gd',hasUrl:typeof url?.url==='string' && url.url.startsWith('http'),br: url?.br ?? null}));
    if (first?.pic_id) {
      const pic = await probe('netease_pic_gd',gd({types:'pic',source:'netease',id:first.pic_id,size:300}));
      console.log('MUSIC_SOURCE_SHAPE',JSON.stringify({source:'netease_pic_gd',hasPic:typeof pic?.url==='string' && pic.url.startsWith('http')}));
    }
    if (first?.lyric_id || id) {
      const lyric = await probe('netease_lyric_gd',gd({types:'lyric',source:'netease',id:first.lyric_id || id}));
      console.log('MUSIC_SOURCE_SHAPE',JSON.stringify({source:'netease_lyric_gd',hasLyric:typeof lyric?.lyric==='string' && lyric.lyric.length>0}));
    }
  }
}
// A response may fail due to region/IP/rights; report shapes without inventing
// a guaranteed global availability verdict.
console.log('MUSIC_SOURCE_PROBE_DONE (anonymous metadata only; no audio downloaded)');
