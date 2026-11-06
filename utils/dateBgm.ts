/** Meet-only background music playlists: separate from regular music and listening together. */
import type { Song } from '../context/MusicContext';
import { musicKey, sameMusic, type DateBgmPlaylist, type GuestMusicLibrary } from './musicLibrary';

export const dateBgmLists = (library: GuestMusicLibrary): DateBgmPlaylist[] => library.dateBgmPlaylists || [];
/** No configured track means no playback request and no user-visible error. */
export const findCharacterDateBgm = (library: GuestMusicLibrary, charId: string): DateBgmPlaylist | null =>
  charId ? dateBgmLists(library).find(pl => pl.characterIds.includes(charId) && pl.songs.length > 0) || null : null;

export const createDateBgmList = (
  library: GuestMusicLibrary, name: string, id: string, at: number,
): GuestMusicLibrary | null => {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || dateBgmLists(library).length >= 80) return null;
  return { ...library, dateBgmPlaylists: [
    ...dateBgmLists(library),
    { id, name: trimmed, songs: [], characterIds: [], createdAt: at, updatedAt: at },
  ] };
};
export const renameDateBgmList = (library: GuestMusicLibrary, id: string, name: string): GuestMusicLibrary | null => {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || !dateBgmLists(library).some(p => p.id === id)) return null;
  return { ...library, dateBgmPlaylists: dateBgmLists(library).map(p =>
    p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p) };
};
export const deleteDateBgmList = (library: GuestMusicLibrary, id: string): GuestMusicLibrary | null =>
  dateBgmLists(library).some(p => p.id === id)
    ? { ...library, dateBgmPlaylists: dateBgmLists(library).filter(p => p.id !== id) }
    : null;

/** A character has one automatic BGM binding; a playlist can belong to several characters. */
export const bindDateBgmCharacter = (
  library: GuestMusicLibrary, listId: string, charId: string, enabled: boolean,
): GuestMusicLibrary | null => {
  if (!charId || !dateBgmLists(library).some(p => p.id === listId)) return null;
  if (enabled && dateBgmLists(library).find(p => p.id === listId)!.characterIds.includes(charId)) return library;
  return { ...library, dateBgmPlaylists: dateBgmLists(library).map(p => {
    const characterIds = p.characterIds.filter(id => id !== charId);
    if (enabled && p.id === listId) characterIds.push(charId);
    return characterIds.length === p.characterIds.length && characterIds.every((id, i) => p.characterIds[i] === id)
      ? p : { ...p, characterIds, updatedAt: Date.now() };
  }) };
};
export const addDateBgmSong = (library: GuestMusicLibrary, id: string, song: Song): GuestMusicLibrary | null => {
  const list = dateBgmLists(library).find(p => p.id === id);
  if (!list || (list.songs.length >= 500 && !list.songs.some(s => sameMusic(s, song)))) return null;
  if (list.songs.some(s => sameMusic(s, song))) return library;
  return { ...library, dateBgmPlaylists: dateBgmLists(library).map(p =>
    p.id === id ? { ...p, songs: [...p.songs, song], updatedAt: Date.now() } : p) };
};
export const removeDateBgmSong = (library: GuestMusicLibrary, id: string, key: string): GuestMusicLibrary | null => {
  if (!dateBgmLists(library).some(p => p.id === id)) return null;
  return { ...library, dateBgmPlaylists: dateBgmLists(library).map(p =>
    p.id === id ? { ...p, songs: p.songs.filter(song => musicKey(song) !== key), updatedAt: Date.now() } : p) };
};
export const moveDateBgmSong = (library: GuestMusicLibrary, id: string, from: number, to: number): GuestMusicLibrary | null => {
  const list = dateBgmLists(library).find(p => p.id === id);
  if (!list || from < 0 || to < 0 || from >= list.songs.length || to >= list.songs.length) return null;
  if (from === to) return library;
  const songs = [...list.songs]; const [song] = songs.splice(from, 1); songs.splice(to, 0, song);
  return { ...library, dateBgmPlaylists: dateBgmLists(library).map(p =>
    p.id === id ? { ...p, songs, updatedAt: Date.now() } : p) };
};
