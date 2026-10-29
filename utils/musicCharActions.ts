/**
 * Char music selection is always source-aware. Prefer exact titles and the
 * user's currently selected platform, never a different provider with the same ID.
 */
import type { Song } from '../context/MusicContext';
import { sameMusic } from './musicLibrary';

type Source = NonNullable<Song['source']>;
export interface CharMusicRequest { phrase: string; source?: Source; explicit: boolean }

export const parseCharMusicRequest = (query: string, currentSource?: Source): CharMusicRequest => {
  const text = (query || '').trim();
  const match = /^(QQ音乐|QQ|tencent|网易云音乐|网易云|netease)\s*[:：]\s*/i.exec(text);
  if (!match) return { phrase: text, source: currentSource, explicit: false };
  return {
    phrase: text.slice(match[0].length).trim(),
    source: /^(qq|tencent)/i.test(match[1]) ? 'tencent' : 'netease',
    explicit: true,
  };
};

export const findCharMusicTrack = (queue: readonly Song[], request: CharMusicRequest): Song | undefined => {
  const name = request.phrase.trim().toLocaleLowerCase();
  if (!name) return undefined;
  const candidates = queue.filter(song => !request.explicit || song.source === request.source ||
    (request.source === 'netease' && song.source === undefined && !song.local));
  const matches = (song: Song) => song.name.trim().toLocaleLowerCase();
  const exact = candidates.filter(song => matches(song) === name);
  const partial = candidates.filter(song => matches(song).includes(name));
  const preferred = (songs: Song[]) => songs.find(song =>
    request.source ? (song.source || 'netease') === request.source && !song.local : false) || songs[0];
  return preferred(exact) || preferred(partial);
};

/** Project state synchronously for same-tick Char join / stop operations. */
export const joinCharListeningState = (
  partners: readonly string[], startedAt: Readonly<Record<string, number>>, id: string, now: number,
): { partners: string[]; startedAt: Record<string, number> } => ({
  partners: partners.includes(id) ? [...partners] : [...partners, id],
  startedAt: { ...startedAt, [id]: startedAt[id] ?? now },
});

export const leaveCharListeningState = (
  partners: readonly string[], startedAt: Readonly<Record<string, number>>, id: string,
): { partners: string[]; startedAt: Record<string, number> } => {
  const remaining = { ...startedAt };
  delete remaining[id];
  return { partners: partners.filter(charId => charId !== id), startedAt: remaining };
};

/** Audio source presence is not proof that playback started. */
export const charMusicPlaybackConfirmed = (
  song: Song, current: Song | null, sourcePresent: boolean, paused: boolean, failed: boolean,
): boolean => !!current && sameMusic(song, current) && sourcePresent && !paused && !failed;

/** The chat-side music card may only claim that a song was saved when
 * MusicProvider actually committed it to the intended Char playlist. */
export const verifiedCharMusicCardIntent = (
  requested: 'join' | 'add' | 'join_and_add', saved: boolean, joined = true,
): 'join' | 'add' | 'join_and_add' | null => {
  if (requested === 'join') return joined ? 'join' : null;
  if (requested === 'add') return saved ? 'add' : null;
  if (saved && joined) return 'join_and_add';
  if (saved) return 'add';
  return joined ? 'join' : null;
};
