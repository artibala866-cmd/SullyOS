/** Pure, source-aware Char playlist changes; apply within an IDB write transaction. */
import type { CharMusicProfile, CharPlaylistSong } from '../types';

export type CharSongTarget = {kind:'existing';title:string} | {kind:'new';title:string;description?:string};
export interface CharSongAppendResult {
  profile: CharMusicProfile;
  playlistTitle: string;
  created: boolean;
  inserted: boolean;
}
export const charPlaylistSongIdentity = (song: CharPlaylistSong): string =>
  song.musicLocal ? `local:${song.id}` :
    `${song.musicSource === 'tencent' ? 'tencent' : 'netease'}:${song.platformId || song.id}`;

export const appendCharPlaylistSong = (
  existing: CharMusicProfile | undefined, song: CharPlaylistSong,
  target?: CharSongTarget, now = Date.now(),
): CharSongAppendResult | null => {
  if (!Number.isSafeInteger(song.id) || !song.name?.trim()) return null;
  const profile: CharMusicProfile = existing || {
    bio: '', genreTags: [], signatureArtists: [], playlists: [],
    likedSongIds: [], recentPlays: [], updatedAt: now,
  };
  const playlists = [...profile.playlists];
  let idx = -1;
  let created = false;
  if (target) {
    const title = target.title.trim();
    if (!title) return null;
    const lowered = title.toLocaleLowerCase();
    idx = playlists.findIndex(p => p.title.trim().toLocaleLowerCase() === lowered);
    if (idx < 0 && target.kind === 'existing') {
      idx = playlists.findIndex(p => p.title.trim().toLocaleLowerCase().includes(lowered) ||
        lowered.includes(p.title.trim().toLocaleLowerCase()));
      if (idx < 0) return null; // Never save into an unrelated playlist.
    }
    if (idx < 0 && target.kind === 'new') {
      playlists.push({
        id: `pl-${now}-${playlists.length}`, title,
        description: (target.description || '').trim(),
        coverStyle: `gradient-0${(playlists.length % 6) + 1}`,
        songs: [], createdAt: now, updatedAt: now,
      });
      idx = playlists.length - 1;
      created = true;
    }
  } else if (playlists.length) idx = 0;
  if (idx < 0) {
    playlists.push({
      id: `pl-${now}-0`, title: '我喜欢的音乐', description: '',
      coverStyle: 'gradient-01', songs: [], createdAt: now, updatedAt: now,
    });
    idx = playlists.length - 1;
    created = true;
  }
  const selected = playlists[idx];
  if (selected.songs.some(s => charPlaylistSongIdentity(s) === charPlaylistSongIdentity(song))) {
    return { profile, playlistTitle: selected.title, created: false, inserted: false };
  }
  playlists[idx] = { ...selected, songs: [...selected.songs, song], updatedAt: now };
  return { profile: { ...profile, playlists, updatedAt: now },
    playlistTitle: playlists[idx].title, created, inserted: true };
};
