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
  song.local ? \`local:\${song.id}\` : \`\${song.source === 'tencent' ? 'tencent' : 'netease'}:\${song.platformId || song.id}\`;

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
      id, name: \`网易云歌曲 #\${id}\`, artists: '', album: '', albumPic: '', duration: 0, fee: 0,
      source: 'netease' as const,
    })) };
  } catch { return emptyLibrary(); }
};
export const persistGuestMusicLibrary = (library: GuestMusicLibrary): void => {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify({
      likes: library.likes.slice(0, 1000),
      playlists: library.playlists.slice(0, 80).map(p => ({ ...p, songs: p.songs.slice(0, 500) })),
      history: library.history.slice(0, 150),
    }));
  } catch { /* quota exceeded: playback must still work */ }
};
export const upsertLikedSong = (songs: Song[], song: Song): Song[] =>
  [song, ...songs.filter(item => !sameMusic(item, song))].slice(0, 1000);
export const recordMusicPlay = (history: PlayedMusic[], song: Song, at = Date.now()): PlayedMusic[] =>
  [{ song, playedAt: at }, ...history.filter(item => !sameMusic(item.song, song))].slice(0, 150);
