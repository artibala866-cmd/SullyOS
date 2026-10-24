/**
 * 全局音乐播放上下文
 *
 * 让音乐在 App 间切换、锁屏、甚至后台退出时都能继续播放：
 *   1. <audio> 元素挂在 Provider 上，不随 MusicApp 卸载销毁。
 *   2. 播放队列、进度、用户 cookie/配置 全部在 Context 中。
 *   3. localStorage 持久化 cookie/工作台地址/队列，刷新后可恢复。
 *   4. Media Session API 暴露锁屏控件 (Android/iOS 原生通知栏也能控制)。
 */
import React, {
  createContext, useCallback, useContext, useEffect,
  useMemo, useRef, useState,
} from 'react';
import { cachedCall as _cachedCall, invalidate as _invalidateCache, clearAll as _clearAllCache } from '../utils/musicCache';
import { DB } from '../utils/db';
import { findPendingMusicInvite } from '../utils/musicInviteStatus';
import { getProxyWorkerUrl, DEFAULT_PROXY_WORKER, PROXY_WORKER_CHANGED_EVENT, isLegacyProxyWorkerUrl } from '../utils/proxyWorker';
import type { PostProcessMusicHooks } from '../utils/applyAssistantPostProcessing';
import { resolveRefToDataUrl } from '../utils/blobRef';

/* ───────────── 类型 ───────────── */
export type MusicQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires';

export interface MusicCfg {
  workerUrl: string;
  cookie: string;
  quality: MusicQuality;
}

export interface Song {
  id: number;
  name: string;
  artists: string;
  album: string;
  albumPic: string;
  duration: number;
  fee: number;
  // ── Local-source extensions (used for AI-generated songs from 写歌 App) ──
  /** True for songs not from netease — play them via blob from IndexedDB. */
  local?: boolean;
  /** IndexedDB key (under DB.assets) where the audio Blob lives. */
  localAssetKey?: string;
  /** Optional MIME type — used to set <audio> source correctly. */
  localMimeType?: string;
  /** Cover gradient/color for songs without album art. */
  localCoverStyle?: string;
  /** Char ID(s) credited as co-author. */
  customAuthorCharIds?: string[];
  /** Raw lyric text (with [Verse]/[Chorus] markers OK) — for synced display. */
  localLyrics?: string;
  /** Manual timestamps (seconds) per visible lyric line — overrides auto distribution. */
  lyricLineTimings?: number[];
}

export interface LyricLine { t: number; text: string; }

export interface NeteaseProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
  signature?: string;
  backgroundUrl?: string;
  vipType?: number;
  province?: number;
  gender?: number;
  followeds?: number;
  follows?: number;
  eventCount?: number;
  playlistCount?: number;
}

/* ───────────── 默认 / 常量 ───────────── */
const LS_CFG_KEY = 'sully_music_cfg_v1';
const LS_STATE_KEY = 'sully_music_state_v1';
const LS_LOCAL_ALBUM_KEY = 'sully_music_local_album_v1';

const loadLocalAlbum = (): Song[] => {
  try {
    const raw = localStorage.getItem(LS_LOCAL_ALBUM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const saveLocalAlbum = (songs: Song[]) => {
  try { localStorage.setItem(LS_LOCAL_ALBUM_KEY, JSON.stringify(songs)); } catch {}
};
// workerUrl 空串 = 跟随「设置 → 网络代理」的中心地址；非空 = 用户在播放器里手填的，
// 只在音乐这一处生效。存的是"跟不跟随"这个意图，不是当时中心地址的一份快照——
// 存快照的话事后分不清"用户敲的"和"当时抄的"，中心一改就留下打不通的幽灵地址。
export const MUSIC_DEFAULT_CFG: MusicCfg = {
  workerUrl: '',
  cookie: '',
  quality: 'exhigh',
};

/* ───────────── 工具 ───────────── */
const normalizeHost = (u: string): string => (u || '').trim().replace(/\/+$/, '');

/**
 * 音乐请求实际要打的地址。每次发请求现算，中心地址改了立刻生效。
 * @param central 只有 MusicProvider 传：它把中心地址放进了 state，好让界面在中心
 *                地址变化时重渲染；其余调用方省略，直接现读中心配置。
 */
export const resolveMusicWorkerUrl = (
  cfg?: Pick<MusicCfg, 'workerUrl'> | null,
  central?: string,
): string => normalizeHost(cfg?.workerUrl || '') || normalizeHost(central || '') || getProxyWorkerUrl();

// 存量迁移：把"其实是跟着中心走"的地址收敛成空串（= 跟随）。命中三种：
//   1. 已死的两个历史公共实例（sully-n.qegj567.workers.dev 国内超时、
//      sullymeow.ccwu213.cc 域名注册过期，2026-07 起 DNS 都解析不到）；
//   2. 当前的公共默认实例；
//   3. 跟当前中心地址一模一样的——老版本会把中心地址抄一份存进音乐配置。
// 只有跟以上都不同的地址才原样保留。读到需要改写时落盘一次。
const migrateWorkerUrl = (url: string | undefined): string => {
  const own = normalizeHost(url || '');
  if (!own) return '';
  const lower = own.toLowerCase();
  if (lower === normalizeHost(DEFAULT_PROXY_WORKER).toLowerCase()) return '';
  if (lower === normalizeHost(getProxyWorkerUrl()).toLowerCase()) return '';
  if (isLegacyProxyWorkerUrl(own)) return '';
  return own;
};

const loadCfg = (): MusicCfg => {
  try {
    const raw = localStorage.getItem(LS_CFG_KEY);
    if (!raw) return { ...MUSIC_DEFAULT_CFG };
    const cfg = { ...MUSIC_DEFAULT_CFG, ...JSON.parse(raw) };
    const migrated = migrateWorkerUrl(cfg.workerUrl);
    if (migrated !== cfg.workerUrl) {
      cfg.workerUrl = migrated;
      try { localStorage.setItem(LS_CFG_KEY, JSON.stringify(cfg)); } catch {}
    }
    return cfg;
  } catch { return { ...MUSIC_DEFAULT_CFG }; }
};

/**
 * 非 React 调用者（Proactive / activeMsgClient / prompt 构造层）读取当前 user 的
 * MusicCfg。走 localStorage 持久化层，不挂 Context。
 */
export const loadMusicCfgStandalone = (): MusicCfg => loadCfg();

/**
 * 实时播放快照 — 给 OSContext 主动消息流程读，避免 OSProvider 在 MusicProvider
 * 外层导致拿不到 useMusic()。MusicProvider mount 后会持续把当前播放状态写到这里。
 */
/**
 * 最近一次「一起听途中换歌」的记录 — 切歌本身不触发任何主动消息，
 * 只把信息留在这里，等 char 下一轮正常回复时经 prompt 注入"察觉"到换歌。
 */
export interface RecentTrackChange {
  previousSong: { id: number; name: string; artists: string };
  /** 换歌那一刻正在"一起听"的 char（只有这些 char 需要被提示） */
  charIds: string[];
  at: number;
}

export interface MusicPlaybackSnapshot {
  current: Song | null;
  playing: boolean;
  lyric: LyricLine[];
  activeLyricIdx: number;
  listeningTogetherWith: string[];
  cfg: MusicCfg;
  recentTrackChange?: RecentTrackChange | null;
  listeningStartedAt?: Record<string, number>;
  listeningInvites?: Record<string, 'pending' | 'accepted' | 'rejected'>;
  lastListeningEnd?: { charId: string; durationMs: number; at: number } | null;
}
let __musicPlaybackSnapshot: MusicPlaybackSnapshot | null = null;
export const loadMusicPlaybackSnapshot = (): MusicPlaybackSnapshot | null => __musicPlaybackSnapshot;

/**
 * 模块级 musicHooks 出口 — 给 ChatParser.MUSIC_ACTION 用的三个钩子打包成一个对象, 由
 * MusicProvider mount 后持续写入最新闭包. 让 useChatAI (本地 fetch 路径) 和
 * activeMsgRuntime (云端回复的冲刷) 都从这里取, 避免逻辑双份维护 / push 路径漏注入.
 * 行为细节见 chatParser.ts 的 MUSIC_ACTION 分支.
 */
let __musicHooks: PostProcessMusicHooks | null = null;
export const loadMusicHooks = (): PostProcessMusicHooks | null => __musicHooks;

const saveCfg = (cfg: MusicCfg) => {
  try { localStorage.setItem(LS_CFG_KEY, JSON.stringify(cfg)); } catch {}
};

const loadState = (): { queue: Song[]; idx: number } => {
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (!raw) return { queue: [], idx: -1 };
    const s = JSON.parse(raw);
    return { queue: Array.isArray(s.queue) ? s.queue : [], idx: typeof s.idx === 'number' ? s.idx : -1 };
  } catch { return { queue: [], idx: -1 }; }
};

const saveState = (queue: Song[], idx: number) => {
  try { localStorage.setItem(LS_STATE_KEY, JSON.stringify({ queue, idx })); } catch {}
};

export const parseLyric = (txt: string): LyricLine[] => {
  if (!txt) return [];
  const out: LyricLine[] = [];
  const re = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;
  for (const line of txt.split(/\r?\n/)) {
    const m = re.exec(line); if (!m) continue;
    const mm = parseInt(m[1], 10), ss = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
    const text = m[4].trim(); if (!text) continue;
    out.push({ t: mm * 60 + ss + ms / 1000, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
};

export const normalizeCookie = (raw: string): string => {
  const s = (raw || '').trim(); if (!s) return '';
  if (s.toUpperCase().startsWith('MUSIC_U=')) return s;
  return `MUSIC_U=${s}`;
};

/**
 * 把网易云返回的 http:// 资源 URL 升级成 https://
 * 浏览器在 HTTPS 页面里加载 http:// 图片会抛 Mixed Content 警告、并强制升级请求，
 * 我们直接在映射层就升级，避免控制台噪音。
 * - 只处理明文 http:// 开头的；https / data / 相对路径保持原样
 * - 空/非字符串直接返回原值
 */
export const toHttps = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http://')) return 'https://' + url.slice('http://'.length);
  return url;
};

/* ───────────── API ───────────── */
export const musicApi = {
  // 内部：真正打网络（不走缓存）
  async _raw(cfg: MusicCfg, path: string, body: any = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const cookie = normalizeCookie(cfg.cookie);
    if (cookie) headers['X-Netease-Cookie'] = cookie;
    const url = `${resolveMusicWorkerUrl(cfg)}/netease${path.startsWith('/') ? path : '/' + path}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
    return j;
  },
  // 对外：默认走 TTL 缓存 + in-flight 去重；无匹配规则的 path 会透传
  async call(cfg: MusicCfg, path: string, body: any = {}) {
    return _cachedCall(path, body, cfg.cookie, () => musicApi._raw(cfg, path, body));
  },
  async search(cfg: MusicCfg, keyword: string, offset = 0) {
    try {
      const result = await musicApi.call(cfg, '/search', { keyword, limit: 30, offset, type: 1 });
      if (result?.result?.songs?.length) return result;
    } catch { /* guest fallback */ }
    const u = new URL('https://music-api.gdstudio.xyz/api.php');
    for (const [k, v] of Object.entries({ types: 'search', source: 'netease', name: keyword, count: '30', pages: String(Math.floor(offset / 30) + 1) })) u.searchParams.set(k, v);
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('免登录搜索服务暂不可用');
    const items = await res.json();
    if (!Array.isArray(items)) throw new Error('免登录搜索数据异常');
    return { result: { songs: items.map((x: any) => ({
      id: Number(x.id), name: x.name, ar: [{ name: Array.isArray(x.artist) ? x.artist.join(' / ') : (x.artist || '') }],
      // GD Studio 的 types=pic 返回的是 JSON {url}，不能直接当 <img src> 使用。
      al: { name: x.album || '', picUrl: typeof x.pic_url === 'string' && /^https:\/\//i.test(x.pic_url) ? x.pic_url : '' },
      dt: Number(x.duration || 0) * 1000, fee: 0,
    })).filter((x: any) => Number.isFinite(x.id)) } };
  },
  async songUrl(cfg: MusicCfg, id: number) {
    try {
      const result = await musicApi.call(cfg, '/song/url', { ids: [id], level: cfg.quality });
      if (result?.data?.[0]?.url) return result;
    } catch { /* guest fallback */ }
    const u = new URL('https://music-api.gdstudio.xyz/api.php');
    for (const [k, v] of Object.entries({ types: 'url', source: 'netease', id: String(id), br: '128' })) u.searchParams.set(k, v);
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('免登录播放服务暂不可用');
    const item = await res.json();
    return { data: [{ url: typeof item?.url === 'string' ? item.url : null }] };
  },
  async lyric(cfg: MusicCfg, id: number) {
    // 优先使用原有 Worker；无歌词或接口失败时，尝试免登录歌词服务。
    try {
      const result = await musicApi.call(cfg, '/lyric', { id });
      if (typeof result?.lrc?.lyric === 'string' && result.lrc.lyric.trim()) return result;
    } catch { /* guest fallback */ }
    const u = new URL('https://music-api.gdstudio.xyz/api.php');
    u.searchParams.set('types', 'lyric');
    u.searchParams.set('source', 'netease');
    u.searchParams.set('id', String(id));
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error('免登录歌词服务暂不可用');
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('免登录歌词数据异常');
    return {
      lrc: { lyric: typeof data.lyric === 'string' ? data.lyric : '' },
      tlyric: { lyric: typeof data.tlyric === 'string' ? data.tlyric : '' },
    };
  },
  loginStatus(cfg: MusicCfg) {
    return musicApi.call(cfg, '/login/status', {});
  },
  userDetail(cfg: MusicCfg, uid: number) {
    return musicApi.call(cfg, '/user/detail', { uid });
  },
  userPlaylist(cfg: MusicCfg, uid: number) {
    return musicApi.call(cfg, '/user/playlist', { uid, limit: 60 });
  },
  userRecord(cfg: MusicCfg, uid: number, type = 1) {
    return musicApi.call(cfg, '/user/record', { uid, type });
  },
  userCloud(cfg: MusicCfg) {
    return musicApi.call(cfg, '/user/cloud', {});
  },
  userSubcount(cfg: MusicCfg) {
    return musicApi.call(cfg, '/user/subcount', {});
  },
  playlistDetail(cfg: MusicCfg, id: number) {
    return musicApi.call(cfg, '/playlist/detail', { id });
  },
  playlistTrackAll(cfg: MusicCfg, id: number, limit = 50, offset = 0) {
    return musicApi.call(cfg, '/playlist/track/all', { id, limit, offset });
  },
  recommendSongs(cfg: MusicCfg) {
    return musicApi.call(cfg, '/recommend/songs', {});
  },
  personalFm(cfg: MusicCfg) {
    return musicApi.call(cfg, '/personal_fm', {});
  },
  dailySignin(cfg: MusicCfg, type = 1) {
    return musicApi.call(cfg, '/daily_signin', { type });
  },
  toplist(cfg: MusicCfg) {
    return musicApi.call(cfg, '/toplist', {});
  },
  loginQrKey(cfg: MusicCfg) {
    return musicApi.call(cfg, '/login/qr/key', {});
  },
  loginQrCreate(cfg: MusicCfg, key: string) {
    return musicApi.call(cfg, '/login/qr/create', { key, qrimg: true });
  },
  loginQrCheck(cfg: MusicCfg, key: string) {
    return musicApi.call(cfg, '/login/qr/check', { key });
  },
  loginCellphone(cfg: MusicCfg, phone: string, captcha: string) {
    return musicApi.call(cfg, '/login/cellphone', { phone, captcha });
  },
  captchaSent(cfg: MusicCfg, phone: string) {
    return musicApi.call(cfg, '/captcha/sent', { phone });
  },
  logout(cfg: MusicCfg) {
    return musicApi.call(cfg, '/logout', {});
  },
};

/* ───────────── Context 定义 ───────────── */
type PlayMode = 'loop' | 'shuffle' | 'single';

interface MusicContextType {
  cfg: MusicCfg;
  setCfg: (next: MusicCfg) => void;
  /** 当前真正在用的服务地址：cfg.workerUrl 留空时 = 中心代理地址 */
  effectiveWorkerUrl: string;

  // 播放队列 / 当前曲
  queue: Song[];
  setQueue: (next: Song[]) => void;
  idx: number;
  current: Song | null;

  // 播放状态
  playing: boolean;
  progress: number;
  duration: number;
  loadingSong: boolean;

  // 歌词
  lyric: LyricLine[];
  tlyric: LyricLine[];
  activeLyricIdx: number;

  // 用户
  profile: NeteaseProfile | null;
  refreshProfile: () => Promise<void>;

  // 操作
  playSong: (song: Song, opts?: { alsoSetQueue?: boolean; replaceQueue?: Song[]; startIdx?: number }) => Promise<void>;
  togglePlay: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seek: (pct: number) => void;

  // 播放模式 & 喜欢
  playMode: PlayMode;
  setPlayMode: (m: PlayMode) => void;
  liked: boolean;
  toggleLike: () => Promise<void>;

  // 一起听 — 当前哪些 char 和 user 一起听（仅视觉状态，不影响播放）
  // 歌曲切换 / 结束时自动清空
  listeningTogetherWith: string[];
  listeningStartedAt: Record<string, number>;
  listeningInvites: Record<string, 'pending' | 'accepted' | 'rejected'>;
  inviteListeningPartner: (charId: string) => void;
  cancelListeningInvite: (charId: string, messageId?: number) => void;
  respondListeningInvite: (charId: string, accepted: boolean) => void;
  lastListeningEnd: { charId: string; durationMs: number; at: number } | null;
  addListeningPartner: (charId: string) => void;
  removeListeningPartner: (charId: string) => void;
  clearListeningPartners: () => void;
  /** 最近一次一起听途中换歌的记录（供 prompt 注入"察觉换歌"，不触发主动消息） */
  recentTrackChange: RecentTrackChange | null;

  // toast 转发 (解耦)
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  setToastHandler: (h: (msg: string, type?: 'info' | 'success' | 'error') => void) => void;

  // 「一起写的歌」专辑 — 从 写歌 App 同步过来的本地生成歌
  localAlbumSongs: Song[];
  addLocalSong: (song: Song) => void;
  removeLocalSong: (songId: number) => void;
  // 实时重录状态 — 让音乐 App 即使在切到其他界面也能看到"正在重录"提示
  regeneratingId: number | null;
  regeneratingStatus: string;
  markRegenerating: (id: number | null, status?: string) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);
export const MusicPreviewProvider = MusicContext.Provider;

/* ───────────── Provider ───────────── */
export const MusicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cfg, setCfgState] = useState<MusicCfg>(loadCfg);
  const setCfg = useCallback((next: MusicCfg) => {
    setCfgState(prev => {
      // 换账号 → 上一个账号的缓存全部失效，避免看到旧账号数据。
      // 换地址那一半由下面 effectiveWorkerUrl 的 effect 统一管（中心地址变化也走那条）。
      if (prev.cookie !== next.cookie) _clearAllCache();
      return next;
    });
    saveCfg(next);
  }, []);

  // 中心地址（设置 → 网络代理）。cfg.workerUrl 留空时用的就是它，进 state 是为了让
  // 设置页显示的"当前生效地址"能跟着变——请求那边不看这份，每次现读中心配置。
  const [centralWorkerUrl, setCentralWorkerUrl] = useState<string>(getProxyWorkerUrl);
  useEffect(() => {
    const onProxyChanged = () => {
      setCentralWorkerUrl(getProxyWorkerUrl());
      // 中心变了会带动存量迁移（存的地址正好等于新中心 → 收敛成"跟随"），重读一次。
      setCfgState(prev => {
        const next = loadCfg();
        return next.workerUrl === prev.workerUrl ? prev : next;
      });
    };
    window.addEventListener(PROXY_WORKER_CHANGED_EVENT, onProxyChanged);
    return () => window.removeEventListener(PROXY_WORKER_CHANGED_EVENT, onProxyChanged);
  }, []);

  const effectiveWorkerUrl = resolveMusicWorkerUrl(cfg, centralWorkerUrl);
  // 生效地址真的变了 → 上一个地址拉回来的东西全部作废（首次挂载不算变）
  const lastWorkerUrlRef = useRef(effectiveWorkerUrl);
  useEffect(() => {
    if (lastWorkerUrlRef.current === effectiveWorkerUrl) return;
    lastWorkerUrlRef.current = effectiveWorkerUrl;
    _clearAllCache();
  }, [effectiveWorkerUrl]);

  const initialState = useMemo(loadState, []);
  const [queue, setQueueState] = useState<Song[]>(initialState.queue);
  const [idx, setIdx] = useState<number>(initialState.idx);
  const current = idx >= 0 && idx < queue.length ? queue[idx] : null;
  // 结束一起听的回调保持稳定，但必须读取最新播放曲目，而不是首次渲染时的空值。
  const currentSongRef = useRef(current);
  currentSongRef.current = current;

  // 「一起写的歌」本地专辑 — 由写歌 App 同步过来的 ACE-Step / MiniMax 出歌
  const [localAlbumSongs, setLocalAlbumSongs] = useState<Song[]>(loadLocalAlbum);
  const addLocalSong = useCallback((song: Song) => {
    setLocalAlbumSongs(prev => {
      // 同 id 去重，新版本覆盖
      const filtered = prev.filter(s => s.id !== song.id);
      const next = [song, ...filtered];
      saveLocalAlbum(next);
      return next;
    });
    // Keep the queue object in sync too. MusicApp downloads from `current`,
    // so a stale queue entry would otherwise keep the pre-regeneration asset key.
    setQueueState(prev => prev.map(item => item.id === song.id ? song : item));
  }, []);
  const removeLocalSong = useCallback((songId: number) => {
    setLocalAlbumSongs(prev => {
      const next = prev.filter(s => s.id !== songId);
      saveLocalAlbum(next);
      return next;
    });
  }, []);

  // 重录状态 — 单个 id + 状态文案，跨 App 可见
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [regeneratingStatus, setRegeneratingStatus] = useState<string>('');
  const markRegenerating = useCallback((id: number | null, status: string = '') => {
    setRegeneratingId(id);
    setRegeneratingStatus(status);
  }, []);

  const setQueue = useCallback((next: Song[]) => {
    setQueueState(next);
  }, []);

  // 队列持久化
  useEffect(() => { saveState(queue, idx); }, [queue, idx]);

  // 播放
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingSong, setLoadingSong] = useState(false);

  // 歌词
  const [lyric, setLyric] = useState<LyricLine[]>([]);
  const [tlyric, setTlyric] = useState<LyricLine[]>([]);
  const activeLyricIdx = useMemo(() => {
    if (!lyric.length) return -1;
    let i = 0;
    for (let k = 0; k < lyric.length; k++) if (lyric[k].t <= progress) i = k; else break;
    return i;
  }, [lyric, progress]);

  // toast 转发
  const toastHandlerRef = useRef<(msg: string, type?: 'info' | 'success' | 'error') => void>(() => {});
  const toast = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    try { toastHandlerRef.current(msg, type); } catch {}
  }, []);
  const setToastHandler = useCallback((h: (msg: string, type?: 'info' | 'success' | 'error') => void) => {
    toastHandlerRef.current = h;
  }, []);

  // 用户信息
  const [profile, setProfile] = useState<NeteaseProfile | null>(null);
  const refreshProfile = useCallback(async () => {
    if (!cfg.cookie) { setProfile(null); return; }
    try {
      const r = await musicApi.loginStatus(cfg);
      const p = r?.data?.profile || r?.profile;
      if (!p) { setProfile(null); return; }
      setProfile({
        userId: p.userId,
        nickname: p.nickname || '',
        avatarUrl: toHttps(p.avatarUrl || ''),
        signature: p.signature || '',
        backgroundUrl: toHttps(p.backgroundUrl || ''),
        vipType: p.vipType ?? 0,
        province: p.province,
        gender: p.gender,
        followeds: p.followeds,
        follows: p.follows,
        eventCount: p.eventCount,
        playlistCount: p.playlistCount,
      });
    } catch { setProfile(null); }
  }, [cfg]);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  // 喜欢列表
  const [likedSet, setLikedSet] = useState<Set<number>>(new Set());
  const [guestLikedSet, setGuestLikedSet] = useState<Set<number>>(() => {
    try {
      const ids = JSON.parse(localStorage.getItem('sully_music_guest_likes_v1') || '[]');
      return new Set<number>(Array.isArray(ids) ? ids.filter((id: unknown) => Number.isInteger(id)) : []);
    } catch { return new Set<number>(); }
  });
  useEffect(() => {
    if (!cfg.cookie) { setLikedSet(new Set()); return; }
    musicApi.call(cfg, '/likelist', {}).then(r => {
      const ids: number[] = r?.ids || r?.data?.ids || [];
      setLikedSet(new Set(ids));
    }).catch(() => {});
  }, [cfg]);

  // 「喜欢」逻辑分两条路:
  //   - 网易云歌 → 走 likelist API
  //   - 本地歌 → 在 localAlbum 里就算喜欢，不在就不喜欢；toggle = add/remove
  const liked = !!current && (
    current.local
      ? localAlbumSongs.some(s => s.id === current.id)
      : (cfg.cookie ? likedSet : guestLikedSet).has(current.id)
  );
  const toggleLike = useCallback(async () => {
    if (!current) return;
    // ── 本地歌：toggle from album ──
    if (current.local) {
      const inAlbum = localAlbumSongs.some(s => s.id === current.id);
      if (inAlbum) {
        removeLocalSong(current.id);
        toast('已从「一起写的歌」移除', 'info');
      } else {
        addLocalSong(current);
        toast('已加入「一起写的歌」', 'success');
      }
      return;
    }
    // ── 免登录歌曲的喜欢只保存到本地，不假装同步到网易云账号 ──
    if (!cfg.cookie) {
      const willLike = !guestLikedSet.has(current.id);
      setGuestLikedSet(prev => {
        const next = new Set(prev);
        if (willLike) next.add(current.id); else next.delete(current.id);
        try { localStorage.setItem('sully_music_guest_likes_v1', JSON.stringify([...next])); } catch {}
        return next;
      });
      toast(willLike ? '已添加到本地喜欢' : '已从本地喜欢移除', 'success');
      return;
    }
    // ── 登录后的网易云歌曲仍同步到账号 ──
    const willLike = !likedSet.has(current.id);
    try {
      await musicApi.call(cfg, '/like', { id: current.id, like: willLike });
      _invalidateCache('/likelist', cfg.cookie);
      setLikedSet(prev => {
        const next = new Set(prev);
        if (willLike) next.add(current.id); else next.delete(current.id);
        return next;
      });
      toast(willLike ? '已添加到喜欢' : '已取消喜欢', 'success');
    } catch (e: any) {
      toast(`喜欢失败: ${e.message}`, 'error');
    }
  }, [current, cfg, likedSet, guestLikedSet, localAlbumSongs, addLocalSong, removeLocalSong, toast]);

  // 播放模式
  const [playMode, setPlayMode] = useState<PlayMode>('loop');

  // 一起听 - char 加入后在 miniPlayer / 播放页显示徽标；切歌 / 结束自动清空
  const [listeningTogetherWith, setListeningTogetherWith] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem('sully_music_together_v1') || '{}'); return Array.isArray(saved.partners) ? saved.partners.filter((id: unknown) => typeof id === 'string') : []; } catch { return []; }
  });
  // 伴听会话与歌曲解耦：记录起始时间，供聊天/主动消息读取。
  const [listeningStartedAt, setListeningStartedAt] = useState<Record<string, number>>(() => {
    try { const saved = JSON.parse(localStorage.getItem('sully_music_together_v1') || '{}'); return saved.startedAt && typeof saved.startedAt === 'object' ? saved.startedAt : {}; } catch { return {}; }
  });
  const [listeningInvites, setListeningInvites] = useState<Record<string, 'pending' | 'accepted' | 'rejected'>>(() => {
    try { const saved = JSON.parse(localStorage.getItem('sully_music_together_v1') || '{}'); return saved.invites && typeof saved.invites === 'object' ? saved.invites : {}; } catch { return {}; }
  });
  const listeningTogetherRef = useRef(listeningTogetherWith);
  listeningTogetherRef.current = listeningTogetherWith;

  useEffect(() => {
    try {
      localStorage.setItem('sully_music_together_v1', JSON.stringify({
        partners: listeningTogetherWith, startedAt: listeningStartedAt, invites: listeningInvites,
      }));
    } catch (err) { console.warn('[MusicTogether] 会话状态持久化失败', err); }
  }, [listeningTogetherWith, listeningStartedAt, listeningInvites]);
  // 刷新后不能仅相信 localStorage 里的 pending：聊天记录可能已经收到回应或被归档。
  // 以完整 DB 历史为准校正状态，避免 Char 再次把已结束的邀请当作待答复。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const pendingIds = Object.keys(listeningInvites).filter(id => listeningInvites[id] === 'pending');
      const reconciled = await Promise.all(pendingIds.map(async charId => {
        const messages = await DB.getMessagesByCharId(charId, true);
        return { charId, pending: !!findPendingMusicInvite(messages, 'user') };
      }));
      if (!alive) return;
      setListeningInvites(prev => {
        let next = prev;
        for (const { charId, pending } of reconciled) {
          if (!pending && next[charId] === 'pending') {
            if (next === prev) next = { ...prev };
            delete next[charId];
          }
        }
        return next;
      });
    })().catch(err => console.warn('[MusicTogether] 待回应邀请校验失败', err));
    return () => { alive = false; };
  // 只在首次加载时读取持久化状态；日常改动由聊天事件同步。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const invitingCharIds = useRef(new Set<string>());
  const inviteListeningPartner = useCallback((charId: string) => {
    if (!charId || invitingCharIds.current.has(charId) || listeningTogetherRef.current.includes(charId)) return;
    invitingCharIds.current.add(charId);
    void (async () => {
      // 一次只允许一条未回应邀请；同时查历史记录，防止刷新或快速连点产生重复卡片。
      const history = await DB.getMessagesByCharId(charId, true);
      const pending = findPendingMusicInvite(history, 'user');
      if (pending) {
        setListeningInvites(prev => ({ ...prev, [charId]: 'pending' }));
        return;
      }
      const messageId = await DB.saveMessage({
        charId,
        role: 'user',
        type: 'system',
        content: '[一起听邀请] 我邀请你一起听音乐。',
        metadata: { musicListenInvite: true, status: 'pending', invitedAt: Date.now() },
      });
      setListeningInvites(prev => ({ ...prev, [charId]: 'pending' }));
      window.dispatchEvent(new CustomEvent('music-listen-invite-created', { detail: { charId, messageId } }));
    })().catch(err => console.warn('[MusicTogether] 邀请消息保存失败', err))
      .finally(() => invitingCharIds.current.delete(charId));
  }, []);
  const cancelListeningInvite = useCallback((charId: string, messageId?: number) => {
    void (async () => {
      const messages = await DB.getMessagesByCharId(charId, true);
      const pending = findPendingMusicInvite(messages, 'user', messageId);
      if (!pending) return;
      await DB.saveMessage({
        charId, role: 'user', type: 'system',
        content: '[一起听邀请] 我撤回了邀请。',
        metadata: { musicListenInviteResponseTo: pending.id, accepted: false, cancelled: true },
      });
      setListeningInvites(prev => {
        const next = { ...prev };
        delete next[charId];
        return next;
      });
      window.dispatchEvent(new CustomEvent('music-listen-invite-resolved', {
        detail: { charId, messageId: pending.id, accepted: false, cancelled: true },
      }));
    })().catch(err => console.warn('[MusicTogether] 撤回邀请失败', err));
  }, []);
  useEffect(() => {
    const onCancel = (event: Event) => {
      const detail = (event as CustomEvent<{ charId?: string; messageId?: number }>).detail;
      if (detail?.charId && Number.isInteger(detail.messageId)) cancelListeningInvite(detail.charId, detail.messageId);
    };
    window.addEventListener('music-listen-invite-cancel', onCancel);
    return () => window.removeEventListener('music-listen-invite-cancel', onCancel);
  }, [cancelListeningInvite]);
  const [lastListeningEnd, setLastListeningEnd] = useState<{ charId: string; durationMs: number; at: number } | null>(null);
  const addListeningPartner = useCallback((charId: string) => {
    setListeningTogetherWith(prev => prev.includes(charId) ? prev : [...prev, charId]);
    setListeningInvites(prev => ({ ...prev, [charId]: 'accepted' }));
    setListeningStartedAt(prev => prev[charId] ? prev : { ...prev, [charId]: Date.now() });
  }, []);
  const respondListeningInvite = useCallback((charId: string, accepted: boolean) => {
    setListeningInvites(prev => ({ ...prev, [charId]: accepted ? 'accepted' : 'rejected' }));
    if (accepted) addListeningPartner(charId);
  }, [addListeningPartner]);
  // Char 接受/拒绝来自用户的邀请只走这一个持久化入口，防止两套动作重复写回应。
  const settlingUserInvites = useRef(new Set<string>());
  const settleUserListeningInvite = useCallback(async (charId: string, accepted: boolean) => {
    if (settlingUserInvites.current.has(charId)) return;
    settlingUserInvites.current.add(charId);
    try {
      const messages = await DB.getMessagesByCharId(charId, true);
      const invite = findPendingMusicInvite(messages, 'user');
      if (invite) {
        await DB.saveMessage({
          charId, role: 'assistant', type: 'system',
          content: accepted ? '[一起听邀请] 已接受邀请。' : '[一起听邀请] 已拒绝邀请。',
          metadata: { musicListenInviteResponseTo: invite.id, accepted },
        });
        window.dispatchEvent(new CustomEvent('music-listen-invite-resolved', {
          detail: { charId, messageId: invite.id, accepted },
        }));
      }
      // Char 在普通对话中主动加入时，不要求必须存在一条邀请卡片。
      if (invite || accepted) respondListeningInvite(charId, accepted);
    } catch (err) {
      console.warn('[MusicTogether] 保存 Char 邀请回应失败', err);
    } finally {
      settlingUserInvites.current.delete(charId);
    }
  }, [respondListeningInvite]);
  const answeringInviteIds = useRef(new Set<number>());
  useEffect(() => {
    const onAnswer = (event: Event) => {
      const detail = (event as CustomEvent<{ charId: string; messageId: number; accepted: boolean }>).detail;
      if (!detail?.charId || !Number.isInteger(detail.messageId) || answeringInviteIds.current.has(detail.messageId)) return;
      answeringInviteIds.current.add(detail.messageId);
      void (async () => {
        const messages = await DB.getMessagesByCharId(detail.charId, true);
        const invitation = messages.find(m => m.id === detail.messageId && m.metadata?.musicListenInvite && m.metadata?.inviter === 'char');
        if (!invitation || messages.some(m => m.metadata?.musicListenInviteResponseTo === detail.messageId)) return;
        await DB.saveMessage({
          charId: detail.charId, role: 'user', type: 'system',
          content: detail.accepted ? '[一起听邀请] 已接受邀请。' : '[一起听邀请] 已拒绝邀请。',
          metadata: { musicListenInviteResponseTo: detail.messageId, accepted: detail.accepted },
        });
        respondListeningInvite(detail.charId, detail.accepted);
        window.dispatchEvent(new CustomEvent('music-listen-invite-resolved', { detail }));
      })().catch(err => console.warn('[MusicTogether] 邀请回应保存失败', err))
        .finally(() => answeringInviteIds.current.delete(detail.messageId));
    };
    window.addEventListener('music-listen-invite-answer', onAnswer);
    return () => window.removeEventListener('music-listen-invite-answer', onAnswer);
  }, [respondListeningInvite]);
  const listeningStartedAtRef = useRef(listeningStartedAt);
  listeningStartedAtRef.current = listeningStartedAt;
  const removeListeningPartner = useCallback((charId: string) => {
    const startedAt = listeningStartedAtRef.current[charId];
    if (startedAt) {
      const at = Date.now();
      const durationMs = Math.max(0, at - startedAt);
      setLastListeningEnd({ charId, durationMs, at });
      const minutes = Math.floor(durationMs / 60000);
      // 作为系统事件存入该角色的聊天历史，让后续聊天可引用真实伴听经历。
      void DB.saveMessage({
        charId, role: 'system', type: 'system',
        content: `[一起听结束] 本次共同听歌持续 ${minutes} 分钟。结束时播放：${currentSongRef.current?.name || '未知歌曲'} - ${currentSongRef.current?.artists || '未知歌手'}。`,
        metadata: {
          musicListenEvent: 'ended', startedAt, endedAt: at, durationMs,
          songId: currentSongRef.current?.id, songName: currentSongRef.current?.name, artists: currentSongRef.current?.artists,
        },
      }).then(messageId => {
        window.dispatchEvent(new CustomEvent('music-listen-session-ended', { detail: { charId, messageId } }));
      }).catch(err => console.warn('[MusicTogether] 结束事件保存失败', err));
      const next = { ...listeningStartedAtRef.current };
      delete next[charId];
      listeningStartedAtRef.current = next;
    }
    setListeningTogetherWith(prev => prev.filter(id => id !== charId));
    setListeningInvites(prev => { const next = { ...prev }; delete next[charId]; return next; });
    setListeningStartedAt(prev => {
      const next = { ...prev }; delete next[charId]; return next;
    });
  }, []);
  const clearListeningPartners = useCallback(() => {
    setListeningTogetherWith(prev => prev.length ? [] : prev);
    Object.keys(listeningStartedAtRef.current).forEach(removeListeningPartner);
  }, [removeListeningPartner]);

  // 切歌后清空上一首的"一起听"。只结束状态，不触发主动消息 ——
  // 换歌信息记进 recentTrackChange，char 下一轮正常回复时经 prompt 注入察觉，
  // 自行决定是否重新加入。
  const previousSongRef = useRef<Song | null>(null);
  const [recentTrackChange, setRecentTrackChange] = useState<RecentTrackChange | null>(null);
  useEffect(() => {
    const previousSong = previousSongRef.current;
    if (previousSong && previousSong.id !== current?.id) {
      const wasListening = listeningTogetherRef.current;
      if (wasListening.length > 0) {
        setRecentTrackChange({
          previousSong: { id: previousSong.id, name: previousSong.name, artists: previousSong.artists },
          charIds: [...wasListening],
          at: Date.now(),
        });
      }
      // 换歌不代表一起听结束；保留角色，切歌记录继续注入聊天上下文。
    }
    previousSongRef.current = current;
  }, [current]);

  // 前进/后退 refs (避免循环依赖 & audio 事件闭包陷阱)
  const queueRef = useRef(queue); queueRef.current = queue;
  const idxRef = useRef(idx); idxRef.current = idx;
  const modeRef = useRef(playMode); modeRef.current = playMode;
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const endedHandlerRef = useRef<() => void>(() => {});

  // 初始化 audio（仅 Provider 生命周期创建一次）
  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    // 注意: 不要设置 crossOrigin — NetEase CDN 没有 CORS 头，会变成静默加载失败
    audioRef.current = a;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setProgress(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    // 播放出错只暂停播放：临时网络故障不应静默结束伴听会话。
    const onErr = () => { setPlaying(false); toast('播放失败', 'error'); };
    const onEnd = () => { endedHandlerRef.current(); };

    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('error', onErr);
    a.addEventListener('ended', onEnd);

    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('error', onErr);
      a.removeEventListener('ended', onEnd);
      try { a.pause(); a.src = ''; } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每次切歌递增序号，阻止慢请求覆盖后一次点播。
  const playRequestSeq = useRef(0);
  // 播放单曲
  const playSong = useCallback(async (song: Song, opts: { alsoSetQueue?: boolean; replaceQueue?: Song[]; startIdx?: number } = {}) => {
    const { alsoSetQueue = true, replaceQueue, startIdx } = opts;
    const requestId = ++playRequestSeq.current;
    const aBeforeLoad = audioRef.current;
    if (aBeforeLoad) {
      const previousUrl = aBeforeLoad.src;
      aBeforeLoad.pause(); aBeforeLoad.removeAttribute('src'); aBeforeLoad.load();
      if (previousUrl.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
    }
    currentSongRef.current = song;

    if (replaceQueue) {
      setQueueState(replaceQueue);
      setIdx(typeof startIdx === 'number' ? startIdx : replaceQueue.findIndex(s => s.id === song.id));
    } else if (alsoSetQueue) {
      const qnow = queueRef.current;
      const existing = qnow.findIndex(s => s.id === song.id);
      if (existing >= 0) {
        setIdx(existing);
      } else {
        setQueueState(q => [...q, song]);
        setIdx(qnow.length);
      }
    }

    setLoadingSong(true); setLyric([]); setTlyric([]); setProgress(0); setDuration(0);
    try {
      // ── Local-source branch ── 本地生成的歌（写歌 App 出歌）从 IndexedDB 取 blob
      if (song.local && !song.localAssetKey) {
        toast('本地歌曲缺少音频文件，无法播放', 'error');
        return;
      }
      if (song.local && song.localAssetKey) {
        const a = audioRef.current!;
        const entry = await DB.getAssetRaw(song.localAssetKey).catch(() => null) as
          | { blob?: Blob; mimeType?: string }
          | Blob
          | null;
        if (requestId !== playRequestSeq.current) return;
        const blob: Blob | null = entry instanceof Blob ? entry : (entry?.blob instanceof Blob ? entry.blob : null);
        if (!blob) {
          toast('本地歌曲文件丢失', 'error');
          setLoadingSong(false);
          return;
        }
        const prevSrc = a.src;
        if (prevSrc.startsWith('blob:')) URL.revokeObjectURL(prevSrc);
        a.src = URL.createObjectURL(blob);
        a.play().catch((err) => { console.warn('[Music] 浏览器拒绝播放音源', err); toast('音源已获取，但浏览器无法开始播放，请尝试下一首或重新播放', 'error'); });

        // ── 本地歌词时间分布 ──
        // MiniMax / ACE-Step 不返回带时间戳的歌词，但我们写歌时就有原文。
        // 等 metadata 加载完拿到 duration → 把每行歌词均匀铺到时长上，
        // 实现「跟着歌词滚动」的网易云播放器体验。
        if (song.localLyrics) {
          const distribute = () => {
            if (requestId !== playRequestSeq.current) return;
            const dur = a.duration;
            if (!isFinite(dur) || dur <= 0) return;
            const lines = song.localLyrics!
              .split(/\r?\n/)
              .map(l => l.trim())
              // 跳过 [Verse]/[Chorus]/[Bridge] 等章节标记（纯时间标，不显示）
              // 也跳过空行
              .filter(l => l && !/^\[[^\]]+\]$/i.test(l));
            if (lines.length === 0) {
              setLyric([]);
              setTlyric([]);
              return;
            }
            // 用户手动对轴的优先用，没对过用平均分布兜底
            let synced: LyricLine[];
            if (song.lyricLineTimings && song.lyricLineTimings.length === lines.length) {
              synced = lines.map((text, i) => ({
                t: song.lyricLineTimings![i] ?? 0,
                text,
              }));
            } else {
              const intro = Math.min(2, dur * 0.05);
              const outro = Math.min(3, dur * 0.05);
              const usable = Math.max(dur - intro - outro, dur * 0.6);
              const step = usable / lines.length;
              synced = lines.map((text, i) => ({
                t: intro + i * step,
                text,
              }));
            }
            setLyric(synced);
            setTlyric([]);
          };
          if (a.readyState >= 1 && isFinite(a.duration) && a.duration > 0) {
            distribute();
          } else {
            const onMeta = () => { distribute(); a.removeEventListener('loadedmetadata', onMeta); };
            a.addEventListener('loadedmetadata', onMeta);
          }
        } else {
          setLyric([]);
          setTlyric([]);
        }

        if ('mediaSession' in navigator) {
          try {
            (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({
              title: song.name,
              artist: song.artists,
              album: song.album,
            });
          } catch {}
        }
        setLoadingSong(false);
        return;
      }

      // 歌词请求不阻塞音频开始播放；慢歌词只能更新对应的那一首歌。
      void musicApi.lyric(cfgRef.current, song.id).then(lyricRes => {
        if (requestId !== playRequestSeq.current) return;
        setLyric(parseLyric(lyricRes?.lrc?.lyric || ''));
        setTlyric(parseLyric(lyricRes?.tlyric?.lyric || ''));
      }).catch(() => {});
      const urlRes = await musicApi.songUrl(cfgRef.current, song.id);
      if (requestId !== playRequestSeq.current) return;
      const url: string | null = urlRes?.data?.[0]?.url || null;
      if (!url) {
        toast(urlRes?.data?.[0]?.fee && !cfgRef.current.cookie ? '需要会员 cookie' : '暂无播放地址', 'error');
        setLoadingSong(false);
        return;
      }
      const a = audioRef.current!;
      a.src = url.replace(/^http:\/\//i, 'https://');
      a.play().catch((err) => {
        if (requestId !== playRequestSeq.current || err?.name === 'AbortError') return;
        console.warn('[Music] 音频开始播放失败', err);
        toast('音源已获取，但播放未能开始，请重新点击播放或切换歌曲', 'error');
      });
      // 媒体会话（锁屏 / 通知栏）
      if ('mediaSession' in navigator) {
        try {
          // 锁屏/通知栏的封面不是 DOM，喂不了 blobref 令牌——那边只认能直接加载的地址。
          // 用户自己上传的歌曲封面存的就是令牌，不解析的话锁屏上是空白（而且不报错）。
          // resolveRefToDataUrl 对非令牌原样返回，所以可以无条件走。
          const artworkSrc = song.albumPic ? await resolveRefToDataUrl(song.albumPic) : '';
          (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({
            title: song.name,
            artist: song.artists,
            album: song.album,
            artwork: artworkSrc ? [
              { src: artworkSrc, sizes: '300x300', type: 'image/jpeg' },
              { src: artworkSrc, sizes: '512x512', type: 'image/jpeg' },
            ] : [],
          });
        } catch {}
      }
    } catch (e: any) {
      if (requestId === playRequestSeq.current) toast(`播放失败：${e?.message || '未知错误'}`, 'error');
    } finally {
      if (requestId === playRequestSeq.current) setLoadingSong(false);
    }
  }, [toast]);

  // 下一首 / 上一首
  const nextSong = useCallback(() => {
    const q = queueRef.current; if (!q.length) return;
    const cur = idxRef.current; if (cur < 0) return;
    let n: number;
    if (modeRef.current === 'shuffle' && q.length > 1) {
      do { n = Math.floor(Math.random() * q.length); } while (n === cur);
    } else if (modeRef.current === 'single') {
      n = cur;
    } else {
      n = (cur + 1) % q.length;
    }
    setIdx(n); playSong(q[n], { alsoSetQueue: false });
  }, [playSong]);

  const prevSong = useCallback(() => {
    const q = queueRef.current; if (!q.length) return;
    const cur = idxRef.current; if (cur < 0) return;
    const n = (cur - 1 + q.length) % q.length;
    setIdx(n); playSong(q[n], { alsoSetQueue: false });
  }, [playSong]);

  // 自动下一首（end 事件）— 通过 ref 转发，以免 useEffect([], []) 闭包陷阱
  useEffect(() => {
    endedHandlerRef.current = () => {
      if (modeRef.current === 'single') {
        const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); }
        return;
      }
      nextSong();
    };
  }, [nextSong]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current; if (!a) return;
    // 刷新后 audio 元素是新创建的、尚未设置 src；此时按播放键应根据持久化的队列按需加载当前曲目
    if (!a.src) {
      const q = queueRef.current; const i = idxRef.current;
      const cur = i >= 0 && i < q.length ? q[i] : null;
      if (cur) playSong(cur, { alsoSetQueue: false });
      return;
    }
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, [playSong]);

  const seek = useCallback((pct: number) => {
    const a = audioRef.current; if (!a || !duration) return;
    a.currentTime = Math.max(0, Math.min(duration, duration * pct));
  }, [duration]);

  // Media Session handlers (锁屏播放/暂停/上下首)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = (navigator as any).mediaSession;
    try {
      ms.setActionHandler('play', () => {
        const a = audioRef.current; if (!a) return;
        if (!a.src) {
          const q = queueRef.current; const i = idxRef.current;
          const cur = i >= 0 && i < q.length ? q[i] : null;
          if (cur) playSong(cur, { alsoSetQueue: false });
          return;
        }
        if (a.paused) a.play().catch(() => {});
      });
      ms.setActionHandler('pause', () => {
        const a = audioRef.current; if (a && !a.paused) a.pause();
      });
      ms.setActionHandler('nexttrack', () => nextSong());
      ms.setActionHandler('previoustrack', () => prevSong());
      ms.setActionHandler('seekto', (details: any) => {
        const a = audioRef.current; if (!a) return;
        if (typeof details.seekTime === 'number') a.currentTime = details.seekTime;
      });
    } catch { /* ignore */ }
  }, [nextSong, prevSong, playSong]);

  // 播放状态同步到 mediaSession
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try { (navigator as any).mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  }, [playing]);

  // 把当前播放状态写到模块级快照，供非 React 调用者（OSContext.runProactive
  // 等位于 MusicProvider 上层的代码）读取。useMusic() 在那一层用不了。
  useEffect(() => {
    __musicPlaybackSnapshot = {
      current,
      playing,
      lyric,
      activeLyricIdx,
      listeningTogetherWith,
      cfg,
      recentTrackChange,
      listeningStartedAt,
      listeningInvites,
      lastListeningEnd,
    };
  }, [current, playing, lyric, activeLyricIdx, listeningTogetherWith, cfg, recentTrackChange, listeningStartedAt, listeningInvites, lastListeningEnd]);

  const creatingCharInvites = useRef(new Set<string>());
  // 把整组 musicHooks 写到模块级 slot — useChatAI 和 activeMsgRuntime 都从这里取.
  // current / addListeningPartner 变化时刷新闭包, 保证读到的是最新 React state.
  // addSongToCharPlaylist 直接落 DB, 落完广播 'char-music-profile-updated' 让 OSContext
  // 把新歌单同步回内存里的角色 (顺带刷主动消息 2.0 的云端快照).
  useEffect(() => {
    __musicHooks = {
      getListeningSnapshot: () => {
        if (!current) return null;
        return {
          songId: current.id,
          name: current.name,
          artists: current.artists,
          album: current.album,
          albumPic: current.albumPic,
          duration: current.duration,
          fee: current.fee,
        };
      },
      joinListeningTogether: async (cid: string) => {
        await settleUserListeningInvite(cid, true);
      },
      inviteUserListening: async (cid: string) => {
        if (creatingCharInvites.current.has(cid) || listeningTogetherRef.current.includes(cid)) return;
        creatingCharInvites.current.add(cid);
        try {
          // AI 每个角色同一时间只保留一条待回应邀请，防止主动消息多次触发叠卡。
          const messages = await DB.getMessagesByCharId(cid, true);
          const pending = findPendingMusicInvite(messages, 'char');
          // 对方已经在等你回应时，不允许 Char 反向再发一张邀请。
          if (pending || findPendingMusicInvite(messages, 'user')) return;
          const messageId = await DB.saveMessage({
            charId: cid, role: 'assistant', type: 'system',
            content: '[一起听邀请] 要不要一起听歌？',
            metadata: { musicListenInvite: true, inviter: 'char', status: 'pending', invitedAt: Date.now() },
          });
          window.dispatchEvent(new CustomEvent('music-listen-invite-created', { detail: { charId: cid, messageId } }));
        } finally {
          creatingCharInvites.current.delete(cid);
        }
      },
      rejectListeningInvite: async (cid: string) => {
        await settleUserListeningInvite(cid, false);
      },
      playListeningTrack: async (cid: string, query: string) => {
        // 只有正在一起听的角色能切歌。优先使用现有队列，找不到再走同一套免登录搜索。
        if (!listeningTogetherRef.current.includes(cid)) return false;
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return false;
        let match: Song | undefined = queueRef.current.find(song =>
          song.name.toLocaleLowerCase() === needle ||
          song.name.toLocaleLowerCase().includes(needle));
        if (!match) {
          try {
            const results = await musicApi.search(cfgRef.current, query.trim());
            const candidates = (results?.result?.songs || []).slice(0, 30);
            const hit = candidates.find((song: any) => String(song.name || '').trim().toLocaleLowerCase() === needle)
              || candidates.find((song: any) => String(song.name || '').toLocaleLowerCase().includes(needle));
            if (hit) {
              match = {
                id: Number(hit.id), name: String(hit.name || ''),
                artists: (hit.ar || hit.artists || []).map((artist: any) => artist.name).join(' / '),
                album: hit.al?.name || hit.album?.name || '',
                albumPic: toHttps(hit.al?.picUrl || hit.album?.picUrl || ''),
                duration: (hit.dt || hit.duration || 0) / 1000,
                fee: hit.fee ?? 0,
              };
              if (!Number.isFinite(match.id)) match = undefined;
            }
          } catch (err) {
            console.warn('[MusicTogether] 角色选歌搜索失败', err);
          }
        }
        if (!listeningTogetherRef.current.includes(cid)) return false;
        if (!match) { toast('角色想播放的歌曲没有找到，请尝试其他歌名', 'info'); return false; }
        await playSong(match);
        return true;
      },
      stopListeningTogether: (cid: string) => {
        removeListeningPartner(cid);
      },
      addSongToCharPlaylist: async (cid, song, target) => {
        try {
          const all = await DB.getAllCharacters();
          const targetChar = all.find(c => c.id === cid);
          if (!targetChar) return null;
          // 尚未生成音乐人格，也应允许 Char 收藏真实歌曲；只建一个未初始化的收藏容器，
          // 不假装 AI 已生成音乐品味。日后初始化时会保留这些收藏。
          const profile = targetChar.musicProfile || {
            bio: '', genreTags: [], signatureArtists: [], playlists: [],
            likedSongIds: [], recentPlays: [], updatedAt: Date.now(),
          };

          const now = Date.now();
          let playlists = profile.playlists.slice();
          let chosenIdx = -1;
          let created = false;

          if (target?.kind === 'new') {
            // 新建歌单 — 标题去重（已存在同名就当成 existing 处理）
            const dup = playlists.findIndex(p =>
              p.title.trim().toLowerCase() === target.title.trim().toLowerCase());
            if (dup >= 0) {
              chosenIdx = dup;
            } else {
              playlists.push({
                id: `pl-${now}-${playlists.length}`,
                title: target.title.trim(),
                description: (target.description || '').trim(),
                coverStyle: `gradient-0${(playlists.length % 6) + 1}`,
                songs: [],
                createdAt: now,
                updatedAt: now,
              });
              chosenIdx = playlists.length - 1;
              created = true;
            }
          } else if (target?.kind === 'existing') {
            const t = target.title.trim().toLowerCase();
            chosenIdx = playlists.findIndex(p => p.title.trim().toLowerCase() === t);
            if (chosenIdx < 0) chosenIdx = playlists.findIndex(p =>
              p.title.trim().toLowerCase().includes(t) || t.includes(p.title.trim().toLowerCase()));
            if (chosenIdx < 0 && playlists.length > 0) chosenIdx = 0;
          } else {
            if (playlists.length > 0) chosenIdx = 0;
          }

          if (chosenIdx < 0) {
            playlists.push({
              id: `pl-${now}-0`,
              title: '我喜欢的音乐',
              description: '',
              coverStyle: 'gradient-01',
              songs: [],
              createdAt: now,
              updatedAt: now,
            });
            chosenIdx = 0;
            created = true;
          }

          const pl = playlists[chosenIdx];
          if (pl.songs.find(s => s.id === song.id)) {
            return { playlistTitle: pl.title, created: false };
          }
          const updatedPl = { ...pl, songs: [...pl.songs, song], updatedAt: now };
          playlists[chosenIdx] = updatedPl;

          const updatedProfile = { ...profile, playlists, updatedAt: now };
          await DB.saveCharacter({ ...targetChar, musicProfile: updatedProfile });
          // 只落 DB 的话内存里那份角色还是旧歌单: 之后随便哪个 updateCharacter 都会拿旧内存
          // 合并写回, 把刚加的歌反向抹掉 (情绪 buff 踩过同一个坑); 主动消息 2.0 的云端快照
          // 也会停在加歌之前, 角色到点还当这首歌没收藏过。交给 OSContext 的监听补这两件事。
          window.dispatchEvent(new CustomEvent('char-music-profile-updated', {
            detail: { charId: cid, musicProfile: updatedProfile },
          }));
          return { playlistTitle: pl.title, created };
        } catch {
          return null;
        }
      },
      favoriteListeningTrack: async (cid, query) => {
        const needle = query?.trim().toLocaleLowerCase();
        const selected = needle
          ? queueRef.current.find(song => song.name.toLocaleLowerCase() === needle || song.name.toLocaleLowerCase().includes(needle))
          : current;
        if (!selected) return false;
        const song: CharPlaylistSong = {
          id: selected.id,
          name: selected.name,
          artists: selected.artists,
          album: selected.album,
          albumPic: selected.albumPic,
          duration: selected.duration,
          fee: selected.fee,
          source: 'discovered',
          addedAt: Date.now(),
        };
        const saved = await __musicHooks?.addSongToCharPlaylist(cid, song, { kind: 'new', title: '我喜欢的音乐', description: '角色主动收藏的歌曲' });
        return !!saved;
      },
    };
  }, [current, removeListeningPartner, playSong, settleUserListeningInvite]);

  const value: MusicContextType = {
    cfg, setCfg, effectiveWorkerUrl,
    queue, setQueue, idx, current,
    playing, progress, duration, loadingSong,
    lyric, tlyric, activeLyricIdx,
    profile, refreshProfile,
    playSong, togglePlay, nextSong, prevSong, seek,
    playMode, setPlayMode,
    liked, toggleLike,
    listeningTogetherWith, listeningStartedAt, listeningInvites, inviteListeningPartner, cancelListeningInvite, respondListeningInvite, lastListeningEnd, addListeningPartner, removeListeningPartner, clearListeningPartners,
    recentTrackChange,
    toast, setToastHandler,
    localAlbumSongs, addLocalSong, removeLocalSong,
    regeneratingId, regeneratingStatus, markRegenerating,
  };

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
};

export const useMusic = (): MusicContextType => {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusic must be used within MusicProvider');
  return ctx;
};
