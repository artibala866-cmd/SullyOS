import React, { useMemo, useState } from 'react';
import { Check, CaretDown, CaretUp, MusicNotes, PencilSimple, Play, Plus, Trash, UserCircle } from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import type { Song } from '../../context/MusicContext';
import type { GuestMusicLibrary } from '../../utils/musicLibrary';
import { musicKey, sameMusic } from '../../utils/musicLibrary';
import { C, VinylDisc } from './MusicUI';

interface Props {
  library: GuestMusicLibrary;
  characters: CharacterProfile[];
  localAlbumSongs: Song[];
  current: Song | null;
  playing: boolean;
  onCreate: (name: string) => boolean;
  onRename: (id: string, name: string) => boolean;
  onDelete: (id: string) => boolean;
  onBind: (id: string, charId: string, enabled: boolean) => boolean;
  onAdd: (id: string, song: Song) => boolean;
  onRemove: (id: string, songKey: string) => boolean;
  onMove: (id: string, from: number, to: number) => boolean;
  onPlay: (song: Song, songs: Song[], index: number) => void;
  onSearch: () => void;
}

export const DateBgmPanel: React.FC<Props> = ({
  library, characters, localAlbumSongs, current, playing,
  onCreate, onRename, onDelete, onBind, onAdd, onRemove, onMove, onPlay, onSearch,
}) => {
  const lists = library.dateBgmPlaylists || [];
  const [newName, setNewName] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [trackQuery, setTrackQuery] = useState('');
  const [charQuery, setCharQuery] = useState('');
  const active = lists.find(pl => pl.id === activeId);
  const available = useMemo(() => {
    const songs = [
      ...library.likes,
      ...library.playlists.flatMap(p => p.songs),
      ...library.history.map(h => h.song),
      ...localAlbumSongs,
    ];
    const map = new Map<string, Song>();
    for (const song of songs) if (!map.has(musicKey(song))) map.set(musicKey(song), song);
    return [...map.values()];
  }, [library.likes, library.playlists, library.history, localAlbumSongs]);
  const addChoices = available.filter(song => !active?.songs.some(s => sameMusic(s, song)) &&
    `${song.name} ${song.artists}`.toLowerCase().includes(trackQuery.trim().toLowerCase()));
  const matchingChars = characters.filter(c => c.name.toLowerCase().includes(charQuery.trim().toLowerCase()));
  const create = () => {
    const trimmed = newName.trim();
    if (!trimmed || !onCreate(trimmed)) return;
    setNewName('');
    setAdding(false);
  };

  return <div className="px-1 pb-6 space-y-5" data-music-date-bgm>
    <header className="px-2 pt-1 flex items-start gap-3">
      <div className="w-[46px] h-[46px] rounded-[16px] flex items-center justify-center shrink-0"
        style={{ background: '#e8e7e5', color: C.text }}><MusicNotes size={24} weight="light" /></div>
      <div className="flex-1">
        <h2 className="font-semibold text-[17px] tracking-[-0.03em]" style={{ color: C.text }}>见面背景音</h2>
        <p className="text-[11px] leading-5 mt-1" style={{ color: C.muted }}>独立的剧情歌单 · 绑定角色后，正式进入见面自动播放</p>
      </div>
      <span className="text-[11px] shrink-0" style={{ color: C.muted }}>{lists.length} 个歌单</span>
    </header>

    <div className="flex gap-2 p-2 rounded-[17px]" style={{ background: '#fff', border: '1px solid #ebebe9' }}>
      <input value={newName} maxLength={60} placeholder="新建见面 BGM 歌单"
        aria-label="新建见面 BGM 歌单名称" className="flex-1 min-w-0 px-3 bg-transparent text-[13px] outline-none"
        onChange={e => setNewName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) create(); }} />
      <button type="button" aria-label="创建见面 BGM 歌单" disabled={!newName.trim()}
        className="music-tap w-10 h-10 rounded-[12px] text-white flex items-center justify-center disabled:opacity-40"
        style={{ background: C.primary }} onClick={create}><Plus size={18} /></button>
    </div>

    {!lists.length && <div className="text-center py-10 rounded-[20px] space-y-2"
      style={{ border: '1px dashed #d8d7d5', color: C.muted }}>
      <MusicNotes size={28} className="mx-auto" weight="thin" />
      <p className="text-[13px]">还没有见面专属歌单</p>
      <p className="text-[11px]">新建后选择角色，再放入喜欢的音乐</p>
    </div>}

    {lists.length > 0 && <div className="space-y-2">
      {lists.map(pl => {
        const chosen = activeId === pl.id;
        const isPlaying = !!current && playing && pl.songs.some(s => sameMusic(s, current));
        const boundNames = characters.filter(c => pl.characterIds.includes(c.id)).map(c => c.name);
        return <button key={pl.id} type="button" aria-expanded={chosen}
          aria-label={`配置见面 BGM 歌单《${pl.name}》`} onClick={() => { setActiveId(chosen ? null : pl.id); setAdding(false); setEditingName(null); setConfirmDelete(null); setCharQuery(''); }}
          className="music-tap w-full flex items-center gap-3 px-3 py-3 rounded-[18px] text-left"
          style={{ background: chosen ? '#eae9e7' : '#fff', border: chosen ? '1px solid #a8a7a3' : '1px solid #ebebe9' }}>
          <div className="w-12 h-12 shrink-0 rounded-[13px] overflow-hidden flex items-center justify-center"
            style={{ background: '#eae9e7' }}>
            {pl.songs[0] ? <VinylDisc albumPic={pl.songs[0].albumPic} picId={pl.songs[0].picId} source={pl.songs[0].source} playing={isPlaying} size={48} />
              : <MusicNotes size={20} weight="thin" color={C.muted} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: C.text }}>{pl.name}</p>
            <p className="text-[11px] mt-1 truncate" style={{ color: C.muted }}>{pl.songs.length} 首 · {boundNames.length ? boundNames.join('、') : '尚未绑定角色'}</p>
          </div>
          {chosen ? <CaretUp size={18} color={C.muted} /> : <CaretDown size={18} color={C.muted} />}
        </button>;
      })}
    </div>}

    {active && <section className="rounded-[20px] p-4 space-y-5" style={{ background: '#fff', border: '1px solid #ecebe8' }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold truncate" style={{ color: C.text }}>歌单设置 · {active.name}</h3>
        <div className="flex gap-1 shrink-0">
          <button type="button" className="music-tap p-2 rounded-full" aria-label="重命名见面 BGM 歌单"
            onClick={() => { setEditingName(active.id); setNameDraft(active.name); setConfirmDelete(null); }}><PencilSimple size={17} /></button>
          <button type="button" className="music-tap p-2 rounded-full" aria-label="删除见面 BGM 歌单"
            onClick={() => { setConfirmDelete(active.id); setEditingName(null); }}><Trash size={17} /></button>
        </div>
      </div>
      {editingName === active.id && <div className="flex gap-2">
        <input className="flex-1 min-w-0 rounded-lg bg-neutral-100 px-3 text-xs" aria-label="修改见面 BGM 歌单名称"
          value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={60} />
        <button type="button" className="music-tap px-4 py-2 bg-neutral-900 text-white text-xs rounded-lg"
          onClick={() => { if (onRename(active.id, nameDraft)) setEditingName(null); }}>保存</button>
        <button type="button" className="music-tap px-3 py-2 text-xs" onClick={() => setEditingName(null)}>取消</button>
      </div>}
      {confirmDelete === active.id && <div className="p-3 rounded-xl bg-neutral-100 text-[12px]">
        确定删除这个见面 BGM 歌单？已存歌曲本身不会删除。
        <div className="flex gap-3 mt-3">
          <button type="button" className="font-semibold text-red-600" onClick={() => {
            if (onDelete(active.id)) { setActiveId(null); setConfirmDelete(null); }
          }}>确认删除</button>
          <button type="button" onClick={() => setConfirmDelete(null)}>取消</button>
        </div>
      </div>}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: C.text }}>
          <UserCircle size={18} /> 绑定见面角色 <span className="font-normal" style={{ color: C.muted }}>· 可多选</span>
        </div>
        <p className="text-[11px] leading-5" style={{ color: C.muted }}>这里使用「见面」中的同一批角色。一个角色仅绑定一份 BGM 歌单，改绑会自动解除旧绑定。</p>
        <input type="search" aria-label="搜索绑定的见面角色" placeholder="查找角色…"
          value={charQuery} onChange={e => setCharQuery(e.target.value)}
          className="w-full rounded-xl bg-neutral-100 px-3 py-2.5 outline-none text-xs" />
        <div className="max-h-44 overflow-y-auto rounded-[13px] p-1 space-y-0.5" style={{ background: '#f7f7f6' }}>
          {matchingChars.map(c => {
            const checked = active.characterIds.includes(c.id);
            const other = lists.find(p => p.id !== active.id && p.characterIds.includes(c.id));
            return <label key={c.id} className="music-tap flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer text-[12px]">
              <input type="checkbox" className="accent-neutral-800" checked={checked}
                onChange={e => onBind(active.id, c.id, e.target.checked)} />
              <span className="truncate flex-1" style={{ color: C.text }}>{c.name}</span>
              {other && !checked && <span className="text-[10px] truncate max-w-20" style={{ color: C.muted }}>原：{other.name}</span>}
              {checked && <Check size={14} weight="bold" />}
            </label>;
          })}
          {!matchingChars.length && <p className="text-xs px-3 py-4" style={{ color: C.muted }}>没有找到角色</p>}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[12px] font-semibold" style={{ color: C.text }}>歌单音乐 <span className="font-normal" style={{ color: C.muted }}>· {active.songs.length} 首</span></h4>
          <button type="button" className="music-tap text-[11px] px-3 py-2 rounded-full" style={{ background: C.soft }}
            onClick={() => { setAdding(x => !x); setTrackQuery(''); }}>{adding ? '收起选曲' : '+ 添加音乐'}</button>
        </div>
        {!active.songs.length && <p className="text-[11px] py-4 text-center" style={{ color: C.muted }}>尚未选音乐，见面时保持原样，不会自动播放或报错。</p>}
        {active.songs.map((song, i) => <div key={musicKey(song)} className="flex items-center gap-2 py-2 border-b border-neutral-100">
          <button type="button" className="music-tap flex-1 min-w-0 text-left" onClick={() => onPlay(song, active.songs, i)}>
            <span className="text-[12px] font-medium truncate block" style={{ color: C.text }}>{i + 1}. {song.name}</span>
            <span className="text-[10px] truncate block mt-1" style={{ color: C.muted }}>{song.artists || (song.local ? '本地创作' : '音乐')}</span>
          </button>
          <button type="button" className="music-tap p-2" aria-label={`播放${song.name}`} onClick={() => onPlay(song, active.songs, i)}><Play size={15} /></button>
          <button type="button" disabled={!i} className="music-tap p-1.5 disabled:opacity-25" aria-label={`上移${song.name}`} onClick={() => onMove(active.id, i, i - 1)}><CaretUp size={15} /></button>
          <button type="button" disabled={i === active.songs.length - 1} className="music-tap p-1.5 disabled:opacity-25" aria-label={`下移${song.name}`} onClick={() => onMove(active.id, i, i + 1)}><CaretDown size={15} /></button>
          <button type="button" className="music-tap p-2" aria-label={`移除${song.name}`} onClick={() => onRemove(active.id, musicKey(song))}><Trash size={15} /></button>
        </div>)}

        {adding && <div className="rounded-[14px] p-3 space-y-2" style={{ background: '#f5f5f4' }}>
          <p className="text-[11px]" style={{ color: C.muted }}>从本地喜欢、普通歌单、播放历史和创作专辑中选择</p>
          <input type="search" aria-label="筛选可加入见面 BGM 的歌曲" placeholder="搜索已存歌曲" value={trackQuery}
            onChange={e => setTrackQuery(e.target.value)} className="w-full rounded-lg bg-white px-3 py-2.5 text-xs outline-none" />
          <div className="max-h-56 overflow-y-auto space-y-1">
            {addChoices.slice(0, 200).map(song => <button type="button" key={musicKey(song)}
              className="music-tap flex gap-2 items-center w-full text-left rounded-lg px-2 py-2 text-[12px] bg-white"
              onClick={() => onAdd(active.id, song)}>
              <Plus size={16} className="shrink-0" />
              <span className="truncate flex-1">{song.name} <span style={{ color: C.muted }}>· {song.artists}</span></span>
            </button>)}
            {!addChoices.length && <p className="text-center text-xs py-5" style={{ color: C.muted }}>这里暂时没有可添加的歌曲</p>}
          </div>
          <button type="button" className="music-tap w-full py-2.5 rounded-lg text-[11px]" style={{ background: '#e6e6e3' }} onClick={onSearch}>去搜索音乐（在歌曲「更多」里选择加入见面 BGM）</button>
        </div>}
      </div>
    </section>}
  </div>;
};
