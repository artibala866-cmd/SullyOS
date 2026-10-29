
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { useMusic, musicApi, musicSongKey, normalizeCookie, toHttps, Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { findPendingMusicInvite } from '../utils/musicInviteStatus';
import { sameMusic } from '../utils/musicLibrary';
import { trackEvent } from '../utils/analytics';
import { Gear, User as UserIcon, Crosshair, Play as PlayIcon, Pause as PauseIcon, Heart, Plus, ListPlus, ArrowUp, ArrowDown, Trash, PencilSimple, CaretDown, CaretUp, MusicNotes, X } from '@phosphor-icons/react';
import {
  C, Sparkle, CrossStar, MizuHeader, SearchBar, SongRow, MiniPlayer,
  VinylDisc, GlassProgress, PlayControls, BokehBg,
  SubActions,
} from './music/MusicUI';
import NeteaseProfilePage from './music/NeteaseProfilePage';
import { shareOrDownloadBlob } from '../utils/shareExport';

// ------------------------- 工具 -------------------------
const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

type View = 'search' | 'settings' | 'player' | 'profile';

// ========================= 主组件 =========================
const MusicApp: React.FC = () => {
  const { closeApp, addToast, characters, userProfile } = useOS();
  const {
    cfg, setCfg, effectiveWorkerUrl,
    current, playing, progress, duration, loadingSong, actualQualityLabel, lyricMessage,
    lyric, tlyric, activeLyricIdx,
    playSong, togglePlay, nextSong, prevSong, seek,
    liked, toggleLike, setToastHandler,
    listeningTogetherWith, listeningStartedAt, listeningInvites, inviteListeningPartner, cancelListeningInvite, respondListeningInvite, removeListeningPartner,
    addLocalSong, removeLocalSong, localAlbumSongs,
    queue, idx, library, toggleLocalLike, createPlaylist, renamePlaylist, deletePlaylist,
    addSongToPlaylist, removeSongFromPlaylist, movePlaylistSong,
    addToQueue, moveQueueSong, removeQueueSong, clearUpcomingQueue,
    playMode, setPlayMode,
    regeneratingId, regeneratingStatus,
  } = useMusic();
  const [charInvites, setCharInvites] = useState<Record<string, { id: number; track?: Song }>>({});
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const entries = await Promise.all(characters.map(async c => {
        // 邀请与回应可能已被记忆宫殿归档；用完整历史判断真正尚未回应的邀请。
        const messages = await DB.getMessagesByCharId(c.id, true);
        const pending = findPendingMusicInvite(messages, 'char');
        return [c.id, pending?.id ? { id: pending.id, track: pending.metadata?.musicListenTrack as Song | undefined } : null] as const;
      }));
      if (!cancelled) setCharInvites(Object.fromEntries(
        entries.filter((entry) => entry[1] !== null) as Array<readonly [string, { id: number; track: Song | undefined }]>
      ));
    };
    void refresh().catch(console.warn);
    const onInvite = () => { void refresh().catch(console.warn); };
    window.addEventListener('music-listen-invite-created', onInvite);
    window.addEventListener('music-listen-invite-resolved', onInvite);
    return () => {
      cancelled = true;
      window.removeEventListener('music-listen-invite-created', onInvite);
      window.removeEventListener('music-listen-invite-resolved', onInvite);
    };
  }, [characters]);
  const answerCharInvite = useCallback(async (charId: string, accepted: boolean) => {
    const messageId = charInvites[charId]?.id;
    if (!messageId) return;
    window.dispatchEvent(new CustomEvent('music-listen-invite-answer', {
      detail: { charId, messageId, accepted },
    }));
  }, [charInvites]);
  const isCurrentRegenerating = !!current && current.id === regeneratingId;
  // 把对轴入口和单曲循环按钮移到 SubActions 里，避免散乱
  // 下载本地生成的歌曲到本地文件系统
  const downloadCurrentLocal = useCallback(async () => {
    if (!current?.local || !current.localAssetKey) return;
    try {
      const entry = await DB.getAssetRaw(current.localAssetKey).catch(() => null) as
        | { blob?: Blob; mimeType?: string }
        | Blob
        | null;
      const blob: Blob | null = entry instanceof Blob
        ? entry
        : (entry?.blob instanceof Blob ? entry.blob : null);
      if (!blob) { addToast('音频文件丢失', 'error'); return; }
      const mime = current.localMimeType || (entry && !(entry instanceof Blob) ? entry.mimeType : '') || blob.type || 'audio/mpeg';
      const ext = /wav/i.test(mime) ? 'wav' : /ogg/i.test(mime) ? 'ogg' : /flac/i.test(mime) ? 'flac' : /m4a|aac|mp4/i.test(mime) ? 'm4a' : 'mp3';
      const safe = (current.name || 'song').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      const result = await shareOrDownloadBlob({ blob, fileName: `${safe}.${ext}`, shareTitle: current.name || '生成的歌曲' });
      if (result === 'cancelled') return;
      addToast(result === 'shared' ? '已打开系统保存/分享' : '已开始下载', 'success');
      trackEvent('下载生成的歌到本地文件');
    } catch {
      addToast('下载失败', 'error');
    }
  }, [current, addToast]);

  const cyclePlayMode = useCallback(() => {
    const order: ('loop' | 'single' | 'shuffle')[] = ['loop', 'single', 'shuffle'];
    const next = order[(order.indexOf(playMode) + 1) % order.length];
    setPlayMode(next);
    trackEvent('切换播放模式', { mode: next });
    addToast(next === 'loop' ? '列表循环' : next === 'single' ? '单曲循环' : '随机播放', 'info');
  }, [playMode, setPlayMode, addToast]);

  // 伴听 char 名单（用于 MiniPlayer / 播放页徽章）—— 带头像，给"小情侣"头像块用
  const companions = useMemo(() => {
    return listeningTogetherWith
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is typeof characters[number] => !!c)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
  }, [listeningTogetherWith, characters]);

  // 当前歌在哪些 char 的歌单里（用于 MiniPlayer 的"也收藏"提示）
  const charsWithSong = useMemo(() => {
    if (!current) return [];
    return characters
      .map(c => {
        const pl = c.musicProfile?.playlists.find(p => p.songs.some(s =>
          s.id === current.id &&
          (s.musicSource || 'netease') === (current.source || 'netease') &&
          (s.platformId || String(s.id)) === (current.platformId || String(current.id)) &&
          !!s.musicLocal === !!current.local));
        return pl ? { id: c.id, name: c.name, playlistTitle: pl.title } : null;
      })
      .filter((x): x is { id: string; name: string; playlistTitle: string } => !!x);
  }, [current, characters]);

  // 把 OS toast 注入到 Music Context（这样全局播放报错也能弹 toast）
  useEffect(() => { setToastHandler(addToast); }, [addToast, setToastHandler]);

  const [view, setView] = useState<View>('search');
  // ── 手动对轴 modal state ──
  const [showLyricSync, setShowLyricSync] = useState(false);
  const [syncDraft, setSyncDraft] = useState<number[]>([]);
  useAppShortcut(ShortcutAppID.Music, intent => {
    // The character's music persona now lives in their optional phone Netease app.
    // Legacy music shortcuts resolve safely to the Music profile rather than a removed view.
    const target=intent.entryId==='visit_char'?'profile':(intent.entryId||'profile');
    setView(target as View);
  });
  const [keyword, setKeyword] = useState('');
  const [searchSource, setSearchSource] = useState<'netease' | 'tencent'>('netease');
  const [section, setSection] = useState<'results' | 'likes' | 'playlists' | 'queue' | 'history'>('results');
  const [playlistName, setPlaylistName] = useState('');
  const [openedPlaylist, setOpenedPlaylist] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(36);
  useEffect(() => { setVisibleCount(36); }, [section, openedPlaylist, searchSource]);
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchSeqRef = useRef(0);
  const lyricBoxRef = useRef<HTMLDivElement | null>(null);

  // 歌词自动滚动：把 current line 对齐到滚动容器视觉中心
  // 注意 offsetTop 依赖 offsetParent，容器没 position:relative 时会跨到祖先节点、值偏大，
  // 导致 current line 被推到中心上方。改用 getBoundingClientRect 对齐，和 DOM 嵌套解耦。
  useEffect(() => {
    if (view !== 'player') return;
    const box = lyricBoxRef.current; if (!box || activeLyricIdx < 0) return;
    const el = box.querySelector<HTMLDivElement>(`[data-lyric-idx="${activeLyricIdx}"]`);
    if (!el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elTopInBox = elRect.top - boxRect.top + box.scrollTop;
    box.scrollTo({ top: elTopInBox - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [activeLyricIdx, view]);

  // ── 搜索 ──
  const doSearch = useCallback(async () => {
    const kw = keyword.trim(); if (!kw) return;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setHasSearched(false);
    setResults([]);
    setSection('results');
    trackEvent('搜索一首歌', { source: searchSource });
    try {
      const songs: Song[] = searchSource === 'tencent'
        ? await musicApi.searchTencent(kw)
        : ((await musicApi.search(cfg, kw))?.result?.songs || []).map((song: any) => ({
            id: Number(song.id), source: 'netease' as const,
            name: String(song.name || ''),
            artists: (song.ar || song.artists || []).map((a: any) => a.name).join(' / '),
            album: song.al?.name || song.album?.name || '',
            albumPic: toHttps(song.al?.picUrl || song.album?.picUrl || ''),
            picId: String(song.pic_id ?? song.al?.pic_id ?? ''),
            lyricId: String(song.lyric_id ?? song.id),
            duration: (song.dt || song.duration || 0) / 1000,
            fee: song.fee ?? 0,
          })).filter((song: Song) => Number.isSafeInteger(song.id));
      if (seq !== searchSeqRef.current) return;
      setResults(songs);
      setHasSearched(true);
      if (!songs.length) addToast('此来源没有找到匹配歌曲', 'info');
    } catch (e: any) {
      if (seq === searchSeqRef.current) addToast(`搜索失败：${e.message}`, 'error');
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }, [keyword, searchSource, cfg, addToast]);

  // The same recognizable transport and compact controls are shared by results,
  // likes, history and the currently opened playlist.
  const renderLibrarySongs = (songs: Song[], playlistId?: string) => (
    <div className="space-y-1 px-1">
      {songs.slice(0, visibleCount).map((song, i) => {
        const isActive = !!current && sameMusic(current, song);
        const isLiked = library.likes.some(s => sameMusic(s, song));
        const label = song.local ? '本地创作' : song.source === 'tencent' ? 'QQ 音乐' : '网易云音乐';
        const handlePlay = () => {
          if (isActive) {
            if (!loadingSong) togglePlay();
          } else if (playlistId) {
            const pl = library.playlists.find(p => p.id === playlistId);
            if (pl) void playSong(song, { replaceQueue: pl.songs, startIdx: i });
          } else void playSong(song);
        };
        return <div key={musicSongKey(song)}
          className="music-track-row rounded-lg px-1 py-1"
          style={{ background: isActive ? '#eeeeed' : '#fff', borderBottom: '1px solid #ebebeb' }}>
          <SongRow name={song.name} artists={song.artists} album={song.album} albumPic={song.albumPic}
            picId={song.picId} source={song.source}
            duration={fmtTime(song.duration)} isVip={song.fee === 1}
            isActive={isActive} isPlaying={isActive && playing} isLoading={isActive && loadingSong}
            onClick={handlePlay} />
          <div className="flex items-center justify-between pl-3 pr-1.5 pb-1 gap-1">
            <span className="text-[10px] font-medium truncate" style={{ color: isActive ? C.primary : C.muted }}>
              {isActive && playing ? '♪ 正在播放' : isActive && loadingSong ? '正在连接音源…' : label}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" aria-label={`将《${song.name}》加入播放队列`} title="加入播放队列"
                className="music-icon-press w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: C.soft, color: C.primary }}
                onClick={() => {
                  const exists = queue.some(item => sameMusic(item, song));
                  addToQueue(song);
                  addToast(exists ? '队列中已有这首歌' : '已加入播放队列', exists ? 'info' : 'success');
                }}><Plus size={17} weight="bold" /></button>
              <button type="button" aria-label={isLiked ? `取消喜欢《${song.name}》` : `喜欢《${song.name}》`}
                aria-pressed={isLiked} title={isLiked ? '取消本地喜欢' : '加入本地喜欢'}
                className={`music-icon-press w-8 h-8 rounded-full flex items-center justify-center ${isLiked ? 'music-heart-active' : ''}`}
                style={{ background: isLiked ? '#dededc' : C.soft,
                  color: isLiked ? C.accent : C.primary }}
                onClick={() => {
                  if (toggleLocalLike(song)) addToast(isLiked ? '已从本地喜欢移除' : '已加入本地喜欢', 'success');
                }}>
                <Heart size={18} weight={isLiked ? 'fill' : 'regular'} />
              </button>
              {library.playlists.length > 0 && <div className="relative w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: C.soft, color: C.primary }}>
                <ListPlus size={17} weight="bold" aria-hidden="true" />
                <select aria-label={`把《${song.name}》加入本地歌单`} title="加入歌单"
                  value="" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  onChange={e => {
                    if (e.target.value) addSongToPlaylist(e.target.value, song);
                  }}>
                  <option value="">加入歌单</option>
                  {library.playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>}
              {playlistId && <>
                <button type="button" className="music-icon-press w-7 h-8 rounded-full disabled:opacity-25"
                  aria-label="上移歌曲" title="上移" disabled={i === 0}
                  onClick={() => movePlaylistSong(playlistId, i, i - 1)}><ArrowUp size={15} /></button>
                <button type="button" className="music-icon-press w-7 h-8 rounded-full disabled:opacity-25"
                  aria-label="下移歌曲" title="下移" disabled={i === songs.length - 1}
                  onClick={() => movePlaylistSong(playlistId, i, i + 1)}><ArrowDown size={15} /></button>
                <button type="button" className="music-icon-press w-7 h-8 rounded-full"
                  aria-label="从歌单移除歌曲" title="从歌单移除"
                  onClick={() => removeSongFromPlaylist(playlistId, musicSongKey(song))}><X size={15} /></button>
              </>}
            </div>
          </div>
        </div>;
      })}
      {songs.length > visibleCount && <button type="button" onClick={() => setVisibleCount(n => n + 36)}
        className="music-tap w-full py-3 text-[12px] rounded-2xl"
        style={{ background: C.soft, color: C.primary }}>继续显示 · 剩余 {songs.length - visibleCount} 首</button>}
      {songs.length === 0 && <div className="flex flex-col items-center justify-center gap-2 py-12"
        style={{ color: C.muted }}>
        <MusicNotes size={29} weight="regular" color={C.muted} />
        <p className="text-xs">暂无歌曲，搜索后即可添加到音乐库</p>
      </div>}
    </div>
  );

  // ════════════════ 搜索页 ════════════════
  const renderSearch = () => (
    <div className="flex flex-col h-full relative"
      style={{ background: C.bg }}>
      <BokehBg />
      <MizuHeader
        title="MUSIC"
        onClose={closeApp}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('profile')}
              aria-label="进入网易云账号专页"
              className="music-icon-press p-2 rounded-full"
              style={{ color: C.primary, background: C.soft }}
              title="网易云账号专页"
            >
              <UserIcon size={16} weight="bold" />
            </button>
            <button
              onClick={() => setView('settings')}
              aria-label="音乐设置"
              className="music-icon-press p-2 rounded-full"
              style={{ color: C.primary }}
            >
              <Gear size={16} weight="bold" />
            </button>
          </div>
        }
      />
      <div className="relative z-10 px-5 pt-5 pb-2">
        <p className="text-[10px] font-medium tracking-[0.2em]" style={{ color: C.muted }}>LISTEN & DISCOVER</p>
        <h1 className="mt-1 text-[25px] font-semibold tracking-tight leading-tight" style={{ color: C.text }}>我的音乐</h1>
      </div>
      <div className="flex justify-start gap-2 px-4 py-2 relative z-10 text-xs" role="group" aria-label="搜索音乐来源">
        {(['netease', 'tencent'] as const).map(src => <button key={src}
          aria-pressed={searchSource === src}
          className="music-tap px-5 py-2.5 rounded-md font-medium"
          style={{ color: searchSource === src ? '#fff' : C.muted,
            background: searchSource === src ? C.primary : '#fff',
            border: `1px solid ${searchSource === src ? C.primary : '#dededc'}` }}
          onClick={() => {
            ++searchSeqRef.current;
            setSearchSource(src); setSearching(false); setHasSearched(false); setResults([]); setSection('results');
          }}>{src === 'netease' ? '网易云音乐' : 'QQ 音乐'}</button>)}
      </div>
      <SearchBar value={keyword} onChange={setKeyword} onSearch={doSearch} searching={searching} />
      <div className="flex gap-1 px-3 pt-1 pb-0 relative z-10 overflow-x-auto text-[11px] shizuku-scrollbar border-b" role="tablist" aria-label="音乐分类">
        {([
          ['results', '搜索结果'], ['likes', '本地喜欢'], ['playlists', '我的歌单'],
          ['queue', '播放队列'], ['history', '播放历史'],
        ] as const).map(([key, title]) =>
          <button key={key} role="tab" className="music-tap shrink-0 px-3.5 py-2.5 font-medium border-b-2"
             aria-selected={section === key}
             style={{ color: section === key ? C.primary : C.muted,
               background: 'transparent', borderColor: section === key ? C.primary : 'transparent' }}
            onClick={() => setSection(key)}>{title}</button>)}
      </div>

      {/* 网易云登录状态只在独立的账号页面展示，主页不再重复显示。 */}

      {/* 音乐库/结果共用现有播放控件 */}
      <div key={section} role="tabpanel" className="music-panel-enter flex-1 overflow-y-auto px-2 pt-1 relative z-10 shizuku-scrollbar"
        style={{ paddingBottom: current ? 126 : 28, background: '#fff' }}>
        {section === 'results' && <div className="px-2 mb-2 text-[11px] flex items-center justify-between" style={{ color: C.muted }}>
          <span>{searching ? '正在搜索…' : results.length ? `找到 ${results.length} 首歌曲` : hasSearched ? '没有找到匹配歌曲，可换关键词或音乐来源' : '搜索歌曲、歌手或专辑'}</span>
          {searching && <span className="w-3.5 h-3.5 border-2 rounded-full border-t-transparent animate-spin" style={{ borderColor: C.primary, borderTopColor: 'transparent' }} />}
        </div>}
        {section === 'results' && (hasSearched && !results.length && !searching
          ? <p className="text-center text-xs px-5 py-12" style={{ color: C.muted }}>搜索完成，没有找到匹配歌曲。可以换一个歌名、歌手或切换来源再试。</p>
          : renderLibrarySongs(results))}
        {section === 'likes' && <>
          <p className="px-3 pb-2 text-[11px]" style={{ color: C.muted }}>本地喜欢 · {library.likes.length} 首</p>
          {renderLibrarySongs(library.likes)}
        </>}
        {section === 'history' && <>
          <p className="px-3 pb-2 text-[11px]" style={{ color: C.muted }}>播放历史 · {library.history.length} 首</p>
          {renderLibrarySongs(library.history.map(h => h.song))}
        </>}
        {section === 'playlists' && <div className="space-y-3 px-1">
          <div className="rounded-lg p-3 flex items-center gap-2"
            style={{ background: '#ffffff', border: `1px solid ${C.soft}` }}>
            <input value={playlistName} onChange={e => setPlaylistName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && playlistName.trim() && createPlaylist(playlistName)) setPlaylistName(''); }}
              placeholder="新建歌单名称" aria-label="新歌单名称" maxLength={60}
              className="rounded-md px-3 py-2.5 min-w-0 flex-1 text-xs outline-none" style={{ background: C.bgDeep, color: C.text }} />
            <button aria-label="新建本地歌单" title="新建歌单" className="music-tap w-10 h-10 rounded-md flex items-center justify-center text-white"
              style={{ background: C.primary }}
              onClick={() => { if (playlistName.trim() && createPlaylist(playlistName)) setPlaylistName(''); }}><Plus size={19} weight="bold" /></button>
          </div>
          {library.playlists.map(pl => {
            const opened = openedPlaylist === pl.id;
            const playingThis = !!current && pl.songs.some(song => sameMusic(current, song));
            return <div key={pl.id} className="rounded-lg p-2.5"
              style={{ background: '#fff', border: `1px solid ${opened ? '#999' : '#e5e5e5'}` }}>
              <div className="flex gap-1.5 items-center">
                <button className="music-tap font-semibold flex-1 min-w-0 text-left rounded-md p-2 flex items-center gap-2"
                  aria-expanded={opened} onClick={() => setOpenedPlaylist(opened ? null : pl.id)}>
                  <span className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: C.soft, color: C.primary }}><MusicNotes size={18} weight="duotone" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]" style={{ color: C.text }}>{pl.name}</span>
                    <span className="block text-[10px] font-normal mt-0.5" style={{ color: C.muted }}>{pl.songs.length} 首歌曲{playingThis ? ' · ♪ 正在听' : ''}</span>
                  </span>
                  {opened ? <CaretUp size={15} color={C.primary} /> : <CaretDown size={15} color={C.primary} />}
                </button>
                <button className="music-icon-press rounded-full w-8 h-8 flex items-center justify-center"
                  style={{ color: C.primary }} aria-label={`重命名《${pl.name}》`} title="重命名"
                  onClick={() => { const n = window.prompt('修改歌单名称', pl.name); if (n?.trim()) renamePlaylist(pl.id, n); }}><PencilSimple size={17} /></button>
                <button className="music-tap rounded-full w-9 h-9 flex items-center justify-center text-white"
                  style={{ background: C.primary }} disabled={!pl.songs.length} aria-label={`播放歌单《${pl.name}》`} title="播放歌单"
                  onClick={() => { if (pl.songs.length) void playSong(pl.songs[0], { replaceQueue: pl.songs, startIdx: 0 }); }}><PlayIcon size={17} weight="fill" /></button>
                <button className="music-icon-press rounded-full w-8 h-8 flex items-center justify-center"
                  style={{ color: C.accent }} aria-label={`删除歌单《${pl.name}》`} title="删除歌单"
                  onClick={() => { if (window.confirm(`删除本地歌单《${pl.name}》？歌曲收藏和历史不会被删除。`)) deletePlaylist(pl.id); }}><Trash size={17} /></button>
              </div>
              {opened && <div className="music-panel-enter mt-3 pt-2" style={{ borderTop: `1px solid ${C.soft}` }}>{renderLibrarySongs(pl.songs, pl.id)}</div>}
            </div>;
          })}
          {!library.playlists.length && <p className="text-xs text-center py-10" style={{ color: C.muted }}>暂无歌单，输入名称后即可创建</p>}
        </div>}
        {section === 'queue' && <div className="space-y-1 px-1">
          <div className="flex justify-between items-center px-2 pb-1 text-xs">
            <span style={{ color: C.muted }}>我的播放队列 · {queue.length} 首</span>
            <button onClick={clearUpcomingQueue} className="music-tap rounded-xl px-3 py-1.5 text-[11px]"
              style={{ color: C.primary, background: C.soft }}>清空待播</button>
          </div>
          {queue.slice(0, visibleCount).map((song, i) => {
            const active = idx === i;
            const onPlay = () => {
              if (active) { if (!loadingSong) togglePlay(); }
              else void playSong(song);
            };
            return <div key={musicSongKey(song)} className="music-track-row rounded-lg px-1 py-1"
              style={{ background: active ? '#eeeeed' : '#fff', borderBottom: '1px solid #ebebeb' }}>
              <SongRow name={song.name} artists={song.artists} album={song.album} albumPic={song.albumPic}
                picId={song.picId} source={song.source}
                duration={fmtTime(song.duration)} isVip={song.fee === 1}
                isActive={active} isPlaying={active && playing} isLoading={active && loadingSong} onClick={onPlay} />
              <div className="flex items-center justify-between pl-3 pr-1.5 pb-1">
                <span className="text-[10px]" style={{ color: active ? C.primary : C.muted }}>
                  {active ? loadingSong ? '正在加载音源…' : playing ? '♪ 正在播放' : '已暂停' : song.local ? '本地' : song.source === 'tencent' ? 'QQ 音乐' : '网易云'}
                </span>
                <div className="flex items-center gap-1.5">
                  <button aria-label="队列中上移" title="上移" disabled={i === 0}
                    className="music-icon-press w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30"
                    style={{ color: C.primary, background: C.soft }} onClick={() => moveQueueSong(i, i - 1)}><ArrowUp size={16} /></button>
                  <button aria-label="队列中下移" title="下移" disabled={i === queue.length - 1}
                    className="music-icon-press w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30"
                    style={{ color: C.primary, background: C.soft }} onClick={() => moveQueueSong(i, i + 1)}><ArrowDown size={16} /></button>
                  <button aria-label="从播放队列移除" title="移除" disabled={active}
                    className="music-icon-press w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30"
                    style={{ color: C.muted, background: '#eeeeec' }}
                    onClick={() => removeQueueSong(i)}><X size={16} /></button>
                </div>
              </div>
            </div>;
          })}
          {queue.length > visibleCount && <button className="music-tap w-full py-3 text-xs rounded-xl" style={{ color: C.primary, background: C.soft }}
            onClick={() => setVisibleCount(n => n + 36)}>继续显示 · 剩余 {queue.length - visibleCount} 首</button>}
          {!queue.length && <p className="text-center text-xs py-10" style={{ color: C.muted }}>播放队列为空</p>}
        </div>}
      </div>

      {characters.length > 0 && (
        <div className="px-5 pb-2 flex items-center gap-2 flex-wrap relative z-10">
          <span className="text-xs font-semibold text-neutral-600">一起听</span>
          {characters.filter(c => !!charInvites[c.id]).map(c => (
            <span key={`char-invite-${c.id}`} className="text-[10px] rounded-full px-2.5 py-1 border border-neutral-300 text-neutral-700">
              {c.name} 邀请你一起听{charInvites[c.id]?.track ? `《${charInvites[c.id].track?.name}》` : ''}
              <button className="ml-2 underline" onClick={() => void answerCharInvite(c.id, true)}>接受</button>
              <button className="ml-2 underline" onClick={() => void answerCharInvite(c.id, false)}>拒绝</button>
            </span>
          ))}
          {characters.filter(c => !charInvites[c.id]).map(c => {
            const active = listeningTogetherWith.includes(c.id);
            const status = listeningInvites[c.id];
            return (
              <span key={c.id} className="text-[10px] rounded-full px-2.5 py-1 border border-neutral-300 text-neutral-600">
                {active ? `与 ${c.name} 一起听 · ${Math.floor((Date.now() - (listeningStartedAt[c.id] || Date.now())) / 60000)} 分钟`
                  : status === 'pending' ? `${c.name} · 等待回应`
                  : status === 'rejected' ? `${c.name} · 已拒绝`
                  : c.name}
                <button className="ml-2 underline" onClick={() => active ? removeListeningPartner(c.id) : status === 'pending' ? cancelListeningInvite(c.id) : inviteListeningPartner(c.id)}>
                  {active ? '结束' : status === 'pending' ? '撤回' : '邀请'}
                </button>
              </span>
            );
          })}
        </div>
      )}
      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          picId={current.picId}
          source={current.source}
          playing={playing}
          loading={loadingSong}
          progress={progress}
          duration={duration}
          onTap={() => { setView('player'); trackEvent('打开播放页'); }}
          onPrev={() => { prevSong(); trackEvent('切歌（上一首/下一首）', { direction: 'prev' }); }}
          onToggle={togglePlay}
          onNext={() => { nextSong(); trackEvent('切歌（上一首/下一首）', { direction: 'next' }); }}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={charId => { removeListeningPartner(charId); trackEvent('结束和角色的一起听'); }}
          charsWithSong={charsWithSong}
          regenStatus={isCurrentRegenerating ? regeneratingStatus : undefined}
        />
      )}
    </div>
  );

  // ════════════════ 播放页 ════════════════
  const renderPlayer = () => {
    if (!current) return null;
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: C.bg }}>
        <BokehBg />
        <MizuHeader title="正在播放" onBack={() => setView('search')} />

        <div className="flex-1 flex flex-col items-center px-5 pt-4 pb-3 relative z-10 overflow-hidden">
          <div className="shrink-0 mt-1 relative">
            <VinylDisc albumPic={current.albumPic} picId={current.picId} source={current.source}
              playing={playing} size={150} bitrate={actualQualityLabel} />
            {/* 重录中覆盖层 — 只在本地歌且 regeneratingId 匹配时显示 */}
            {isCurrentRegenerating && (
              <div className="absolute inset-0 rounded-md flex items-center justify-center pointer-events-none"
                style={{
                  background: `radial-gradient(circle, rgba(0, 0, 0,0.55) 30%, rgba(0, 0, 0,0.35) 70%)`,
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  boxShadow: 'none',
                  animation: 'none',
                }}
              >
                <div className="text-center space-y-1.5 px-3">
                  <div className="w-7 h-7 mx-auto border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <div className="text-[10px] tracking-[0.2em] text-white font-semibold" style={{ fontFamily: 'Georgia, serif' }}>
                    正在重录
                  </div>
                  <div className="text-[9px] text-white/80 truncate max-w-[120px]" style={{ fontFamily: 'monospace' }}>
                    {regeneratingStatus || '处理中…'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 横幅形式的重录提示 — 进入播放页第一时间看到状态 */}
          {isCurrentRegenerating && (
            <div className="mt-3 px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] tracking-wider"
              style={{
                background: '#eeeeec',
                border: `1px solid ${C.glow}60`,
                color: C.primary,
              }}
            >
              <Sparkle size={9} color={C.sakura} delay={0} />
              <span>新版本即将到来 · {regeneratingStatus || '处理中'}</span>
              <Sparkle size={9} color={C.lavender} delay={0.5} />
            </div>
          )}

          <section className="mt-5 text-center space-y-1.5 shrink-0 px-2">
            <h2 className="font-light tracking-tight leading-tight"
              style={{ color: C.text, fontFamily: 'inherit', fontSize: '20px', fontWeight: 650 }}>
              {current.name}
            </h2>
            <p className="text-[12px]"
              style={{ color: C.muted, letterSpacing: '0.01em' }}>
              {current.artists}
            </p>
          </section>

          <div
            ref={lyricBoxRef}
            className="flex-1 w-full my-3 min-h-0 overflow-y-auto text-center scroll-smooth shizuku-scrollbar px-2"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
            }}
          >
            {lyric.length === 0 ? (
              <div className="pt-6 flex flex-col items-center gap-2" style={{ color: C.faint }}>
                <Sparkle size={12} color={C.glow} />
                <span className="text-[12px]" style={{ fontFamily: 'inherit' }}>
                  {lyricMessage || (loadingSong ? '正在加载歌词…' : '暂无歌词')}
                </span>
              </div>
            ) : (
              <div className="space-y-4 py-8">
                {lyric.map((l, i) => {
                  const tr = tlyric.find(t => Math.abs(t.t - l.t) < 0.2);
                  const active = i === activeLyricIdx;
                  // 关键：字号 / 字重不随 active 变 —— 变了会触发重排换行。
                  //     只让外层盒子用 transform:scale 视觉放大，不动内部文字度量。
                  return (
                    <div key={i} data-lyric-idx={i}
                      className="transition-opacity duration-150"
                      style={{ opacity: active ? 1 : 0.42 }}>
                      <div className="flex items-center justify-center gap-2 px-3">
                        <CrossStar
                          size={12}
                          color={C.sakura}
                          delay={0}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                        <div
                          className="text-[16px] leading-[1.4]"
                          style={{
                            fontFamily: 'inherit',
                            fontWeight: active ? 650 : 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            color: active ? C.text : C.muted,
                          }}
                        >
                          {l.text}
                        </div>
                        <CrossStar
                          size={12}
                          color={C.lavender}
                          delay={0.9}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                      </div>
                      {tr && (
                        <div
                          className="text-[12px] leading-[1.4] mt-1 px-3"
                          style={{
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            opacity: active ? 0.78 : 0.4,
                            color: active ? C.accent : C.faint,
                          }}
                        >
                          {tr.text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="w-full shrink-0 max-w-sm">
            <GlassProgress progress={progress} duration={duration} fmtTime={fmtTime} onSeek={seek} />
          </div>

          <div className="shrink-0 relative">
            <Sparkle size={9} className="absolute top-1 left-[30%]" color={C.sakura} delay={0} />
            <Sparkle size={7} className="absolute top-3 right-[28%]" color={C.lavender} delay={1.2} />
            <PlayControls
              playing={playing}
              loading={loadingSong}
              onPrev={() => { prevSong(); trackEvent('切歌（上一首/下一首）', { direction: 'prev' }); }}
              onToggle={togglePlay}
              onNext={() => { nextSong(); trackEvent('切歌（上一首/下一首）', { direction: 'next' }); }}
            />
          </div>

          <div className="shrink-0 mt-3 w-full">
            <SubActions
              liked={liked}
              onLike={() => { toggleLike(); trackEvent('收藏或取消收藏当前歌', { action: liked ? 'unlike' : 'like' }); }}
              showSync={!!(current.local && current.localLyrics && lyric.length > 0)}
              onSync={() => {
                setSyncDraft(lyric.map(l => l.t));
                setShowLyricSync(true);
                trackEvent('打开歌词对轴面板');
              }}
              showDownload={!!(current.local && current.localAssetKey)}
              onDownload={downloadCurrentLocal}
              playMode={playMode}
              onCyclePlayMode={cyclePlayMode}
            />
          </div>
        </div>
      </div>
    );
  };

  // ════════════════ 设置页 ════════════════
  const renderSettings = () => {
    const setDraft = (updates: Partial<typeof cfg>) => setCfg({ ...cfg, ...updates });
    const commit = () => {
      addToast('已保存', 'success');
      setView('search');
    };
    const followsCentral = !cfg.workerUrl.trim();
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: C.bg }}>
        <BokehBg />
        <MizuHeader title="设置" onBack={() => setView('search')} />
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-sm relative z-10 shizuku-scrollbar">
          <div className="rounded-lg p-3.5 shizuku-glass" style={{ boxShadow: 'none' }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center justify-between" style={{ color: C.muted }}>
              <span className="flex items-center gap-1.5"><Sparkle size={6} color={C.glow} delay={0} /> 服务地址</span>
              {!followsCentral && (
                <button onClick={() => setDraft({ workerUrl: '' })}
                  className="text-[9px] underline" style={{ color: C.muted }}>改回跟随中心</button>
              )}
            </div>
            <input className="w-full rounded-md px-3 py-2 outline-none text-xs shizuku-glass" value={cfg.workerUrl}
              onChange={e => setDraft({ workerUrl: e.target.value })} placeholder={effectiveWorkerUrl}
              style={{ color: C.text }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              {followsCentral
                ? <>跟随「设置 → 网络代理」：{effectiveWorkerUrl}</>
                : <>只在音乐里用这个地址，「设置 → 网络代理」改了也不跟</>}
            </div>
          </div>
          <div className="rounded-lg p-3.5 shizuku-glass" style={{ boxShadow: 'none' }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.sakura} delay={0.5} /> 会员 Cookie
            </div>
            <textarea className="w-full rounded-md px-3 py-2 outline-none text-[10px] shizuku-glass" rows={3} value={cfg.cookie}
              onChange={e => setDraft({ cookie: e.target.value })} placeholder="MUSIC_U=xxx 或直接粘贴值..."
              style={{ color: C.text, fontFamily: 'monospace', resize: 'none' }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              也可以在「我的」页面里扫码 / 手机号登录，自动填入 cookie
            </div>
          </div>
          <div className="rounded-lg p-3.5 shizuku-glass" style={{ boxShadow: 'none' }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.lavender} delay={1} /> 音质
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const).map(q => (
                <button key={q} onClick={() => { setDraft({ quality: q }); trackEvent('切换音质档位', { quality: q }); }}
                  className="py-2 rounded-md text-[10px] transition-all"
                  style={{
                    background: cfg.quality === q ? `#171717` : C.glass,
                    color: cfg.quality === q ? 'white' : C.muted,
                    border: cfg.quality === q ? '1px solid transparent' : `1px solid rgba(230,230,230,.8)`,
                    boxShadow: cfg.quality === q ? `0 2px 12px ${C.glow}30` : 'none',
                    backdropFilter: 'blur(8px)',
                  }}
                >{q}</button>
              ))}
            </div>
            <div className="text-[10px] mt-1.5 leading-relaxed" style={{ color: C.muted }}>这是优先请求的音质档位，实际播放质量以音源服务返回为准；QQ 匿名来源可能无法报告码率。lossless / hires 可能需要会员授权。</div>
          </div>
          <div className="space-y-3 pt-1">
            <button
              onClick={async () => {
                trackEvent('运行音乐服务诊断');
                const lines: string[] = [];
                const ck = normalizeCookie(cfg.cookie);
                lines.push(`Worker: ${effectiveWorkerUrl}${followsCentral ? '（跟随中心）' : '（音乐单独设的）'}`);
                lines.push(`Cookie: ${ck ? ck.slice(0, 18) + '...(' + ck.length + 'c)' : '(未填)'}`);
                try {
                  const res = await fetch(`${effectiveWorkerUrl}/netease/search`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { 'X-Netease-Cookie': ck } : {}) },
                    body: JSON.stringify({ keyword: '晴天', limit: 3 }),
                  });
                  lines.push(`HTTP ${res.status}`);
                  const txt = await res.text(); lines.push(txt.slice(0, 800));
                  try { const j = JSON.parse(txt); lines.push(`---\ncode=${j.code}  songs=${j?.result?.songs?.length ?? 'N/A'}`); } catch {}
                } catch (e: any) { lines.push(`异常: ${e.message}`); }
                alert(lines.join('\n'));
              }}
              className="w-full py-2.5 rounded-2xl text-[10px] tracking-wider shizuku-glass transition-all"
              style={{ color: C.vip, border: `1px solid ${C.vip}30` }}
            >诊断（搜索晴天）</button>
            <button onClick={commit}
              className="w-full py-3 rounded-2xl text-xs text-white tracking-wider transition-all relative overflow-hidden"
              style={{ background: C.primary }}>
              <span className="relative z-10">保存</span>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: `linear-gradient(90deg, transparent 30%, rgba(255,255,255,.18) 50%, transparent 70%)`,
                backgroundSize: '200% 100%', animation: 'none',
              }} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div key={view} className="absolute inset-0 music-panel-enter">
        {view === 'search' && renderSearch()}
        {view === 'player' && renderPlayer()}
        {view === 'settings' && renderSettings()}
        {view === 'profile' && (
          <NeteaseProfilePage
            onBack={() => setView('search')}
            onOpenPlayer={() => setView('player')}
            onOpenSearch={() => setView('search')}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </div>
      {/* 手动对轴 modal — 全屏覆盖，不开新 view */}
      {showLyricSync && current && current.local && (() => {
        const fmt = (s: number) => {
          if (!isFinite(s)) return '0:00.0';
          const m = Math.floor(s / 60);
          const sec = (s % 60).toFixed(1).padStart(4, '0');
          return `${m}:${sec}`;
        };
        const setLineTime = (idx: number, t: number) => {
          setSyncDraft(prev => {
            const next = [...prev];
            next[idx] = Math.max(0, t);
            return next;
          });
        };
        const tapCurrent = (idx: number) => setLineTime(idx, progress);
        const resetAuto = () => {
          if (!duration || duration <= 0) return;
          const intro = Math.min(2, duration * 0.05);
          const outro = Math.min(3, duration * 0.05);
          const usable = Math.max(duration - intro - outro, duration * 0.6);
          const step = usable / lyric.length;
          setSyncDraft(lyric.map((_, i) => intro + i * step));
        };
        const saveSync = () => {
          if (!current) return;
          // 把 draft 写到 song.lyricLineTimings 里 → addLocalSong 上行覆盖
          const updated: Song = { ...current, lyricLineTimings: syncDraft };
          addLocalSong(updated);
          // 重新 playSong 让 LyricLine 立即用新时间
          playSong(updated, { alsoSetQueue: false });
          setShowLyricSync(false);
          addToast('对轴已保存', 'success');
          trackEvent('保存歌词对轴');
        };

        return (
          <div className="absolute inset-0 z-50 flex flex-col"
            style={{ background: C.bg }}>
            <BokehBg />
            {/* Header */}
            <div className="relative z-10 shizuku-glass-strong"
              style={{ borderBottom: `1px solid rgba(230,230,230,.8)`, paddingTop: 'var(--safe-top)' }}>
              <div className="flex items-center justify-between h-12 px-4">
                <button onClick={() => setShowLyricSync(false)} className="text-[11px] px-2 py-1 rounded-full" style={{ color: C.muted }}>取消</button>
                <div className="flex items-center gap-1.5">
                  <Crosshair size={13} weight="duotone" color={C.primary} />
                  <span className="text-[12px] tracking-[0.25em]" style={{ color: C.primary, fontFamily: 'Georgia, serif' }}>歌词对轴</span>
                </div>
                <button onClick={saveSync} className="text-[11px] font-bold px-3 py-1 rounded-full"
                  style={{
                    background: C.primary,
                    color: 'white',
                    boxShadow: 'none',
                  }}>保存</button>
              </div>
            </div>

            {/* Live progress + transport */}
            <div className="relative z-10 px-4 pt-3 pb-2 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={togglePlay}
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  style={{
                    background: C.primary,
                    color: 'white',
                    boxShadow: 'none',
                  }}
                >
                  {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: C.muted, fontFamily: 'monospace' }}>
                    <span style={{ color: C.primary, fontWeight: 600 }}>{fmt(progress)}</span>
                    <span>{fmt(duration)}</span>
                  </div>
                  <div className="h-1 rounded-full shizuku-glass cursor-pointer relative"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      seek((e.clientX - rect.left) / rect.width);
                    }}
                  >
                    <div className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                        background: C.primary,
                      }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button onClick={resetAuto} className="text-[10px] underline" style={{ color: C.muted }}>
                  重置为均匀分布
                </button>
                <p className="text-[10px] flex-1 text-right" style={{ color: C.muted }}>
                  播放时点 ⊙ 把当前时间设给那一句
                </p>
              </div>
            </div>

            {/* Lyric list with tap-to-set */}
            <div className="flex-1 overflow-y-auto px-3 pb-6 shizuku-scrollbar relative z-10 pt-1">
              {lyric.length === 0 ? (
                <div className="text-center text-[11px] py-12" style={{ color: C.faint }}>没有歌词可对轴</div>
              ) : (
                <div className="space-y-1.5">
                  {lyric.map((l, i) => {
                    const t = syncDraft[i] ?? l.t;
                    const isActive = i === activeLyricIdx;
                    return (
                      <div key={i}
                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 transition-all"
                        style={{
                          background: isActive
                            ? `#ececeb`
                            : 'rgba(255, 255, 255,0.5)',
                          border: `1px solid ${isActive ? C.glow + '60' : C.faint + '30'}`,
                          boxShadow: isActive ? `0 2px 12px ${C.glow}30` : 'none',
                        }}
                      >
                        <span className="text-[9px] tabular-nums w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</span>
                        <button
                          onClick={() => tapCurrent(i)}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-90 transition-all"
                          style={{
                            background: `${C.primary}15`,
                            border: `1px solid ${C.primary}30`,
                            color: C.primary,
                          }}
                          title="把这一句设到当前播放时间"
                        >
                          ⊙
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] truncate" style={{ color: isActive ? C.primary : C.text, fontWeight: isActive ? 600 : 400 }}>
                            {l.text}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] tabular-nums" style={{ color: C.muted, fontFamily: 'monospace' }}>{fmt(t)}</span>
                            <button
                              onClick={() => setLineTime(i, t - 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >−.2s</button>
                            <button
                              onClick={() => setLineTime(i, t + 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >+.2s</button>
                            <button
                              onClick={() => seek(duration > 0 ? t / duration : 0)}
                              className="text-[9px] px-1 rounded ml-auto"
                              style={{ color: C.accent }}
                            >跳到此处</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

    </div>
  );
};

export default MusicApp;
import { useAppShortcut } from '../utils/appShortcutLaunch';
import { AppID as ShortcutAppID } from '../types';
