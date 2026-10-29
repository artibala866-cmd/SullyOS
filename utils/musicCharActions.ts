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

/** Audio source presence is not proof that playback started. */
export const charMusicPlaybackConfirmed = (
  song: Song, current: Song | null, sourcePresent: boolean, paused: boolean, failed: boolean,
): boolean => !!current && sameMusic(song, current) && sourcePresent && !paused && !failed;
