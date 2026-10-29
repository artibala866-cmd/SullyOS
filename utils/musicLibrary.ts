/**
 * Local, account-independent music library. No remote account data is written here.
 * Legacy unqualified numeric ids always refer to NetEase; local generated music
 * remains under its own identity. URL strings are never persisted as media blobs.
 */
import type { Song } from '../context/MusicContext';

export type MusicSource = 'netease' | 'tencent';
export interface LocalMusicPlaylist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
}
export interface PlayedMusic { song: Song; playedAt: number; }
export interface GuestMusicLibrary {
  likes: Song[];
  playlists: LocalMusicPlaylist[];
  history: PlayedMusic[];
}

export const musicKey = (song: Pick<Song, 'id' | 'source' | 'platformId' | 'local'>): string =>
  song.local ? `local:${song.id}` : `${song.source === 'tencent' ? 'tencent' : 'netease'}:${song.platformId || song.id}`;

export const sameMusic = (a: Pick<Song, 'id' | 'source' | 'platformId' | 'local'>, b: Pick<Song, 'id' | 'source' | 'platformId' | 'local'>) =>
  musicKey(a) === musicKey(b);

// QQ's MID is sometimes alphanumeric. Keep Song.id numeric for older consumers;
// the real platformId is used for all network requests and deduplication.
export const numericMusicId = (value: string): number => {
  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  let hash = 2166136261;
  for (const ch of value) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0) || 1;
};

const names = (raw: unknown): string => {
  if (Array.isArray(raw)) return raw.map(v => typeof v === 'string' ? v : String(v?.name ?? v?.title ?? '')).filter(Boolean).join(' / ');
  return typeof raw === 'string' ? raw : String((raw as any)?.name ?? '');
};
const httpUrl = (value: unknown): string => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return '';
  return value.trim().replace(/^http:\/\//i, 'https://');
};
export const extractMusicUrl = (raw: unknown, depth = 0): string => {
  if (depth > 4) return '';
  if (typeof raw === 'string') return httpUrl(raw);
  if (!raw || typeof raw !== 'object') return '';
  if (Array.isArray(raw)) return raw.map(v => extractMusicUrl(v, depth + 1)).find(Boolean) || '';
  const obj = raw as Record<string, unknown>;
  for (const k of ['url', 'src', 'audio', 'play_url', 'playUrl', 'location', 'data', 'result', 'song', 'info']) {
    const found = extractMusicUrl(obj[k], depth + 1);
    if (found) return found;
  }
  return '';
};

export const tencentSearchRows = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw;
  const root = raw?.data ?? raw?.result ?? raw;
  for (const value of [root?.list, root?.songs, root?.song?.list, root?.song, root?.data, root]) {
    if (Array.isArray(value)) return value;
  }
  return [];
};
export const normalizeTencentSong = (raw: any): Song | null => {
  if (!raw || typeof raw !== 'object') return null;
  const platformId = String(raw.id ?? raw.songId ?? raw.song_id ?? raw.songid ?? raw.mid ?? raw.songmid ?? '').trim();
  const mid = String(raw.mid ?? raw.songmid ?? raw.songMid ?? '').trim();
  const name = String(raw.name ?? raw.song ?? raw.title ?? '').trim();
  if (!platformId || !name) return null;
  const album = typeof raw.album === 'object' && raw.album !== null ? raw.album : null;
  return {
    id: numericMusicId(platformId),
    platformId,
    mid: mid || undefined,
    source: 'tencent',
    name,
    artists: names(raw.artist ?? raw.singer ?? raw.artists ?? raw.ar),
    album: String(album?.name ?? raw.albumName ?? (typeof raw.album === 'string' ? raw.album : '') ?? ''),
    albumPic: httpUrl(raw.coverUrl ?? raw.cover ?? raw.pic_url ?? raw.pic ?? album?.picUrl),
    picId: String(raw.pic_id ?? raw.picId ?? ''),
    lyricId: String(raw.lyric_id ?? raw.lyricId ?? platformId),
    duration: Math.max(0, Number(raw.duration ?? raw.interval ?? 0)),
    fee: 0,
  };
};

const LIBRARY_KEY = 'sully_music_guest_library_v1';
const LEGACY_LIKES_KEY = 'sully_music_guest_likes_v1';
const validSong = (value: any): value is Song => value && Number.isSafeInteger(value.id) && typeof value.name === 'string';
const emptyLibrary = (): GuestMusicLibrary => ({ likes: [], playlists: [], history: [] });

/** Validate a backup *before* any primary database is replaced.
 * A missing field means an older backup and must never erase today's library.
 * Keep sources, playlist ordering and localAssetKey (not the audio Blob) intact.
 */
export const validateGuestMusicLibraryBackup = (value: unknown): GuestMusicLibrary => {
  const record = value as Partial<GuestMusicLibrary> | null;
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      !Array.isArray(record.likes) || !Array.isArray(record.playlists) ||
      !Array.isArray(record.history)) throw new Error('备份中的本地音乐库结构无效');
  if (record.likes.length > 1000 || record.playlists.length > 80 ||
      record.history.length > 150) throw new Error('备份中的本地音乐库条目超出容量限制');
  const checkSong = (s: any): s is Song =>
    validSong(s) && !!s.name.trim() && typeof s.artists === 'string' &&
    typeof s.album === 'string' && typeof s.albumPic === 'string' &&
    typeof s.duration === 'number' && Number.isFinite(s.duration) &&
    typeof s.fee === 'number' &&
    (s.source === undefined || s.source === 'netease' || s.source === 'tencent') &&
    (s.platformId === undefined || typeof s.platformId === 'string') &&
    (s.localAssetKey === undefined || typeof s.localAssetKey === 'string');
  if (!record.likes.every(checkSong)) throw new Error('备份中的喜欢歌曲信息损坏');
  if (!record.playlists.every((p: any) =>
      p && typeof p.id === 'string' && p.id.length > 0 &&
      typeof p.name === 'string' && Array.isArray(p.songs) &&
      p.songs.length <= 500 && p.songs.every(checkSong) &&
      Number.isFinite(p.createdAt) && Number.isFinite(p.updatedAt)
  )) throw new Error('备份中的本地歌单信息损坏');
  if (!record.history.every((h: any) =>
      h && checkSong(h.song) && Number.isFinite(h.playedAt)
  )) throw new Error('备份中的播放历史信息损坏');
  return {
    likes: record.likes,
    playlists: record.playlists as LocalMusicPlaylist[],
    history: record.history as PlayedMusic[],
  };
};

export const loadGuestMusicLibrary = (): GuestMusicLibrary => {
  try {
    const saved = localStorage.getItem(LIBRARY_KEY);
    if (saved) {
      const value = JSON.parse(saved);
      if (value && typeof value === 'object') return {
        likes: Array.isArray(value.likes) ? value.likes.filter(validSong).slice(0, 1000) : [],
        playlists: Array.isArray(value.playlists) ? value.playlists.filter((p: any) => p && typeof p.id === 'string' && Array.isArray(p.songs)).map((p: any) => ({ ...p, songs: p.songs.filter(validSong) })).slice(0, 80) : [],
        history: Array.isArray(value.history) ? value.history.filter((r: any) => r && validSong(r.song) && Number.isFinite(r.playedAt)).slice(0, 150) : [],
      };
    }
    // Import the old id-only likes exactly once; missing metadata can be
    // replaced when a matching song is played or searched later.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LIKES_KEY) || '[]');
    if (!Array.isArray(legacy)) return emptyLibrary();
    return { ...emptyLibrary(), likes: [...new Set<number>(legacy.filter((id: unknown) => Number.isSafeInteger(id)))].map(id => ({
      id, name: `网易云歌曲 #${id}`, artists: '', album: '', albumPic: '', duration: 0, fee: 0,
      source: 'netease' as const,
    })) };
  } catch { return emptyLibrary(); }
};
/** Return false instead of pretending a favorite or playlist was saved.
 * Never silently truncate user-created playlists on persistence. */
export const persistGuestMusicLibrary = (library: GuestMusicLibrary): boolean => {
  if (library.likes.length > 1000 || library.playlists.length > 80 ||
      library.history.length > 150 || library.playlists.some(p => p.songs.length > 500)) return false;
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
    return true;
  } catch (err) {
    console.warn('[MusicLibrary] 保存失败（存储空间不足或浏览器拒绝）', err);
    return false;
  }
};
/** Add a local playlist in one library transaction, optionally with its first song.
 * Callers persist this whole snapshot once; never create an empty playlist first.
 */
export const appendGuestMusicPlaylist = (
  library: GuestMusicLibrary, name: string, id: string, now: number, firstSong?: Song,
): GuestMusicLibrary | null => {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || library.playlists.length >= 80) return null;
  return {
    ...library,
    playlists: [...library.playlists, {
      id, name: trimmed, songs: firstSong ? [firstSong] : [], createdAt: now, updatedAt: now,
    }],
  };
};

export const upsertLikedSong = (songs: Song[], song: Song): Song[] =>
  [song, ...songs.filter(item => !sameMusic(item, song))].slice(0, 1000);
export const recordMusicPlay = (history: PlayedMusic[], song: Song, at = Date.now()): PlayedMusic[] =>
  [{ song, playedAt: at }, ...history.filter(item => !sameMusic(item.song, song))].slice(0, 150);
