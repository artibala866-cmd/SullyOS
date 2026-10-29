/**
 * One-tap touch sheet for saving a song to a local playlist.
 * No native select dropdown, and no extra detour through the playlists tab.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, ListPlus, Plus, X } from '@phosphor-icons/react';
import type { Song } from '../../context/MusicContext';
import type { LocalMusicPlaylist } from '../../utils/musicLibrary';
import { sameMusic } from '../../utils/musicLibrary';
import { C } from './MusicUI';

export const MusicPlaylistSheet: React.FC<{
  song: Song;
  playlists: LocalMusicPlaylist[];
  onAdd: (playlistId: string) => boolean;
  onCreateAndAdd: (name: string) => boolean;
  onClose: () => void;
}> = ({ song, playlists, onAdd, onCreateAndAdd, onClose }) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const create = () => {
    if (!name.trim()) return;
    if (onCreateAndAdd(name.trim())) onClose();
  };

  return <div className="absolute inset-0 z-[65] flex flex-col justify-end"
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <button type="button" aria-label="关闭加入歌单" onClick={onClose}
      className="absolute inset-0 bg-black/45" />
    <section role="dialog" aria-modal="true" aria-labelledby="music-add-playlist-title"
      className="relative flex flex-col rounded-t-2xl bg-white shadow-[0_-12px_40px_rgba(0,0,0,.24)] overflow-hidden music-panel-enter"
      style={{ maxHeight: 'min(78dvh, 690px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="w-10 h-1 rounded-full self-center mt-3 mb-2 shrink-0" style={{ background: '#d1d1d1' }} aria-hidden="true" />
      <div className="flex items-center justify-between gap-3 px-5 py-2 border-b" style={{ borderColor: '#ededed' }}>
        <div className="min-w-0">
          <h2 id="music-add-playlist-title" className="text-[15px] font-semibold flex items-center gap-2" style={{ color: C.text }}>
            <ListPlus size={19} /> 加入歌单
          </h2>
          <p className="text-[12px] truncate mt-1" style={{ color: C.muted }}>{song.name} · {song.artists}</p>
        </div>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="关闭加入歌单"
          className="music-icon-press w-11 h-11 shrink-0 rounded-full flex items-center justify-center"
          style={{ color: C.text, background: C.soft }}><X size={19} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto shizuku-scrollbar px-4 py-3">
        <button type="button" className="music-tap w-full min-h-12 flex items-center gap-3 rounded-lg px-3 text-left"
          style={{ background: C.soft, color: C.text }} onClick={() => setCreating(v => !v)}
          aria-expanded={creating}>
          <Plus size={20} />
          <span className="text-[13px] font-medium flex-1">新建歌单并加入这首歌</span>
          <span className="text-[17px]">{creating ? '−' : '+'}</span>
        </button>
        {creating && <div className="flex gap-2 pt-3 pb-3 px-1">
          <input ref={inputRef} aria-label="新歌单名称" maxLength={60}
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); create(); } }}
            placeholder="输入歌单名称"
            className="flex-1 min-w-0 h-12 px-3 text-[13px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            style={{ background: C.bgDeep, color: C.text }} />
          <button type="button" onClick={create} disabled={!name.trim()}
            className="music-tap h-12 px-4 rounded-lg text-[13px] font-semibold disabled:opacity-40"
            style={{ background: C.primary, color: '#fff' }}>创建并加入</button>
        </div>}
        <p className="px-1 pt-4 pb-2 text-[11px] font-semibold" style={{ color: C.muted }}>
          我的歌单 · {playlists.length} 个
        </p>
        {playlists.map(pl => {
          const already = pl.songs.some(item => sameMusic(item, song));
          const full = pl.songs.length >= 500;
          return <button type="button" key={pl.id} disabled={already || full}
            aria-label={`${already ? '已在' : '加入'}《${pl.name}》`}
            className="music-tap min-h-[54px] w-full flex items-center gap-3 border-b text-left px-2 disabled:opacity-55"
            style={{ borderColor: '#eeeeee', color: C.text }}
            onClick={() => { if (onAdd(pl.id)) onClose(); }}>
            <div className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg"
              style={{ background: C.soft }}><ListPlus size={18} /></div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate">{pl.name}</p>
              <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>{pl.songs.length} 首歌曲</p>
            </div>
            {already
              ? <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: C.muted }}><Check size={14} /> 已加入</span>
              : <span className="text-[11px] shrink-0" style={{ color: C.muted }}>{full ? '已满' : '加入'}</span>}
          </button>;
        })}
        {!playlists.length && <p className="text-xs text-center py-8" style={{ color: C.muted }}>
          还没有歌单，直接在上面新建即可
        </p>}
      </div>
    </section>
  </div>;
};
