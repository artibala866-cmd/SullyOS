/**
 * Source-aware decisions shared by the one global music player.
 * Apply selected queue/index to synchronous refs before React batches another click.
 */
import type { Song } from '../context/MusicContext';
import { sameMusic } from './musicLibrary';

export const selectMusicQueueTrack = (
  queue: readonly Song[],
  song: Song,
  options: { replaceQueue?: readonly Song[]; startIdx?: number } = {},
): { queue: Song[]; idx: number } => {
  if (options.replaceQueue) {
    const next = [...options.replaceQueue];
    const n = options.startIdx;
    const idx = n !== undefined && Number.isInteger(n) &&
      n >= 0 && n < next.length && sameMusic(next[n], song)
      ? n : next.findIndex(s => sameMusic(s, song));
    return { queue: next, idx };
  }
  const index = queue.findIndex(s => sameMusic(s, song));
  if (index >= 0) return { queue: [...queue], idx: index };
  return { queue: [...queue, song], idx: queue.length };
};

export type MusicPlayAction = 'wait' | 'resolve' | 'play' | 'pause';
export const chooseMusicPlayAction = ({
  srcPresent, mediaError, paused, resolving, allowPause,
}: {
  srcPresent: boolean; mediaError: boolean; paused: boolean;
  resolving: boolean; allowPause: boolean;
}): MusicPlayAction => {
  if (resolving) return 'wait';
  if (!srcPresent || mediaError) return 'resolve';
  if (paused) return 'play';
  return allowPause ? 'pause' : 'wait';
};
