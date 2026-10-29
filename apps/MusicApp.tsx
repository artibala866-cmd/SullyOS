
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { useMusic, musicApi, musicSongKey, normalizeCookie, toHttps, Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { findPendingMusicInvite } from '../utils/musicInviteStatus';
import { sameMusic } from '../utils/musicLibrary';
import { trackEvent } from '../utils/analytics';
import { Gear, User as UserIcon, Crosshair, Play as PlayIcon, Pause as PauseIcon, Heart, Plus, ListPlus, DotsThreeVertical, Trash, PencilSimple, CaretDown, CaretUp, MusicNotes, Headphones } from '@phosphor-icons/react';
import {
  C, Sparkle, CrossStar, MizuHeader, SearchBar, SongRow, MiniPlayer,
  VinylDisc, GlassProgress, PlayControls, BokehBg,
  SubActions,
} from './music/MusicUI';
import NeteaseProfilePage from './music/NeteaseProfilePage';
import { MusicQueueSheet } from './music/MusicQueueSheet';
import { MusicPlaylistSheet } from './music/MusicPlaylistSheet';
import { MusicTogetherSheet } from './music/MusicTogetherSheet';
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
    queue, idx, library, toggleLocalLike, createPlaylist, createPlaylistWithSong, renamePlaylist, deletePlaylist,
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
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  const [togetherSheetOpen, setTogetherSheetOpen] = useState(false);
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
  const [section, setSection] = useState<'results' | 'likes' | 'playlists' | 'history'>('results');
  const [playlistName, setPlaylistName] = useState('');
  const [openedPlaylist, setOpenedPlaylist] = useState<string | null>(null);
  const [playlistSheetSong, setPlaylistSheetSong] = useState<Song | null>(null);
  const [openSongMenuKey, setOpenSongMenuKey] = useState<string | null>(null);
  const openSongMenuRef = useRef<HTMLDivElement | null>(null);
  // Inline menus must scroll into view if expanded at the bottom of a long list.
  useEffect(() => {
    if (openSongMenuKey) openSongMenuRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [openSongMenuKey]);
  useEffect(() => { setOpenSongMenuKey(null); }, [section, openedPlaylist, searchSource]);
  const [editingPlaylist, setEditingPlaylist] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmPlaylistId, setDeleteConfirmPlaylistId] = useState<string | null>(null);
  const savePlaylistName = () => {
    if (!editingPlaylist) return;
    const name = editingPlaylist.name.trim();
    const previous = library.playlists.find(p => p.id === editingPlaylist.id);
    if (!name || !previous) return;
    if (previous.name === name || renamePlaylist(editingPlaylist.id, name)) {
      setEditingPlaylist(null);
      if (previous.name !== name) addToast('歌单已重命名', 'success');
    }
  };
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
  const doSearch = useCallback(async (sourceOverride?: 'netease' | 'tencent') => {
    const kw = keyword.trim(); if (!kw) return;
    const source = sourceOverride || searchSource;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setHasSearched(false);
    setResults([]);
    setSection('results');
    trackEvent('搜索一首歌', { source });
    try {
      const songs: Song[] = source === 'tencent'
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
    <div className="space-y-2 px-1">
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
        const key = musicSongKey(song);
        return <div key={key}
          className="music-track-row rounded-[15px] px-1.5 py-1"
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpenSongMenuKey(null);
          }}
          style={{ background: isActive ? '#f1f1ef' : '#fff', border: '1px solid #ebebe9' }}>
          <div className="flex items-center min-w-0">
            <div className="flex-1 min-w-0">
              <SongRow name={song.name} artists={song.artists} album={song.album}
                albumPic={song.albumPic} picId={song.picId} source={song.source}
                sourceLabel={label}
                duration={fmtTime(song.duration)} isVip={song.fee === 1}
                isActive={isActive} isPlaying={isActive && playing} isLoading={isActive && loadingSong}
                onClick={handlePlay} />
            </div>
            <div className="flex items-center shrink-0 gap-0 pr-0.5">
              <button type="button" aria-label={isLiked ? `取消喜欢《${song.name}》` : `喜欢《${song.name}》`}
                aria-pressed={isLiked} title={isLiked ? '取消本地喜欢' : '加入本地喜欢'}
                className={`music-icon-press w-9 h-10 rounded-full flex items-center justify-center ${isLiked ? 'music-heart-active' : ''}`}
                style={{ color: isLiked ? C.primary : C.muted }}
                onClick={() => {
                  if (toggleLocalLike(song)) addToast(isLiked ? '已从本地喜欢移除' : '已加入本地喜欢', 'success');
                }}>
                <Heart size={18} weight={isLiked ? 'fill' : 'regular'} />
              </button>
              <button type="button" aria-label={`更多歌曲操作《${song.name}》`}
                aria-haspopup="menu" aria-expanded={openSongMenuKey === key}
                className="music-icon-press w-9 h-10 rounded-full flex items-center justify-center"
                style={{ color: C.muted }}
                onClick={() => setOpenSongMenuKey(openSongMenuKey === key ? null : key)}>
                <DotsThreeVertical size={20} weight="regular" />
              </button>
            </div>
          </div>
          {openSongMenuKey === key && <div ref={openSongMenuRef} role="menu" aria-label={`歌曲《${song.name}》操作`}
            className="music-track-menu mt-1.5 mb-1.5 rounded-[15px] p-1.5 w-full"
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpenSongMenuKey(null); } }}
            style={{ background: '#fff', border: '1px solid #e6e6e3', boxShadow: '0 8px 24px rgba(0,0,0,.10)' }}>
            <button type="button" role="menuitem" className="music-tap w-full min-h-10 px-3 text-left text-[12px] rounded-[10px]"
              onClick={() => {
                const exists = queue.some(item => sameMusic(item, song));
                addToQueue(song);
                addToast(exists ? '队列中已有这首歌' : '已加入播放队列', exists ? 'info' : 'success');
                setOpenSongMenuKey(null);
              }}>加入播放队列</button>
            <button type="button" role="menuitem" className="music-tap w-full min-h-10 px-3 text-left text-[12px] rounded-[10px]"
              onClick={() => { setPlaylistSheetSong(song); setOpenSongMenuKey(null); }}>加入本地歌单</button>
            {playlistId && <>
              <div className="h-px mx-2 my-1" style={{ background: '#eeecea' }} />
              <button type="button" role="menuitem" disabled={i === 0}
                className="music-tap w-full min-h-10 px-3 text-left text-[12px] rounded-[10px] disabled:opacity-40"
                onClick={() => { movePlaylistSong(playlistId, i, i - 1); setOpenSongMenuKey(null); }}>上移一首</button>
              <button type="button" role="menuitem" disabled={i === songs.length - 1}
                className="music-tap w-full min-h-10 px-3 text-left text-[12px] rounded-[10px] disabled:opacity-40"
                onClick={() => { movePlaylistSong(playlistId, i, i + 1); setOpenSongMenuKey(null); }}>下移一首</button>
              <button type="button" role="menuitem" className="music-tap w-full min-h-10 px-3 text-left text-[12px] rounded-[10px]"
                onClick={() => { removeSongFromPlaylist(playlistId, musicSongKey(song)); setOpenSongMenuKey(null); }}>从歌单移除</button>
            </>}
          </div>}
        </div>;
      })}
      {songs.length > visibleCount && <button type="button" onClick={() => setVisibleCount(n => n + 36)}
        className="music-tap w-full py-3 text-[12px] rounded-sm"
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
          <div className="flex items-center gap-0.5">
            {characters.length > 0 && <button type="button" aria-label="打开一起听"
              title="一起听" aria-haspopup="dialog" aria-expanded={togetherSheetOpen}
              className="music-icon-press relative w-10 h-10 rounded-full flex items-center justify-center"
              style={{ color: C.primary }}
              onClick={() => { setQueueSheetOpen(false); setTogetherSheetOpen(true); }}>
              <Headphones size={20} weight="regular" />
              {(Object.keys(charInvites).length > 0 || listeningTogetherWith.length > 0 ||
                Object.values(listeningInvites).some(status => status === 'pending')) &&
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full"
                  aria-label="有一起听动态" style={{ background: C.primary, border: '1px solid white' }} />}
            </button>}
            <button
              onClick={() => setView('profile')}
              aria-label="进入网易云账号专页"
              className="music-icon-press p-2 rounded-sm"
              style={{ color: C.primary }}
              title="网易云账号专页"
            >
              <UserIcon size={16} weight="bold" />
            </button>
            <button
              onClick={() => setView('settings')}
              aria-label="音乐设置"
              className="music-icon-press p-2 rounded-sm"
              style={{ color: C.primary }}
            >
              <Gear size={16} weight="bold" />
            </button>
          </div>
        }
      />
      <div className="relative z-10 px-5 pt-5 pb-2.5">
        <p className="text-[10px] font-medium tracking-[0.21em] uppercase" style={{ color: C.muted }}>SULLY / AUDIO</p>
        <div className="flex items-end justify-between gap-4 mt-2.5">
          <h1 className="text-[25px] font-semibold tracking-[-0.04em] leading-tight" style={{ color: C.text }}>音乐</h1>
          <span className="text-[11px] tracking-[0.02em] pb-1 shrink-0" style={{ color: C.muted }}>我的私人曲库</span>
        </div>
      </div>
      {section === 'results' && <>
      <div className="flex justify-start gap-2 px-5 pt-2 relative z-10 text-xs" role="group" aria-label="搜索音乐来源">
        {(['netease', 'tencent'] as const).map(src => <button key={src}
          aria-pressed={searchSource === src}
          className="music-tap px-3.5 py-2 rounded-full font-medium"
          style={{ color: searchSource === src ? C.primary : C.muted,
            background: searchSource === src ? '#eaeae8' : 'transparent' }}
          onClick={() => {
            if (src === searchSource) return;
            setSearchSource(src);
            // Reuse the current query when changing sources; no second Search tap.
            if (keyword.trim() && (hasSearched || searching)) {
              void doSearch(src);
            } else {
              ++searchSeqRef.current;
              setSearching(false); setHasSearched(false); setResults([]); setSection('results');
            }
          }}>{src === 'netease' ? '网易云音乐' : 'QQ 音乐'}</button>)}
      </div>
      <SearchBar value={keyword} onChange={setKeyword} onSearch={doSearch} searching={searching} />
      </>}
      <div className="flex gap-1 px-4 pt-1 pb-2 relative z-10 overflow-x-auto text-[12px] shizuku-scrollbar" role="tablist" aria-label="音乐分类">
        {([
          ['results', '搜索结果'], ['likes', '本地喜欢'], ['playlists', '我的歌单'],
          ['history', '播放历史'],
        ] as const).map(([key, title]) =>
          <button key={key} role="tab" className="music-tap shrink-0 px-3.5 py-2.5 font-medium rounded-full"
             aria-selected={section === key}
             style={{ color: section === key ? C.primary : C.muted,
               background: section === key ? '#eaeae8' : 'transparent' }}
            onClick={() => setSection(key)}>{title}</button>)}
      </div>

      {/* 网易云登录状态只在独立的账号页面展示，主页不再重复显示。 */}

      {/* 音乐库/结果共用现有播放控件 */}
      <div key={section} role="tabpanel" className="music-panel-enter flex-1 min-h-0 overflow-y-auto px-4 pt-3 relative z-10 shizuku-scrollbar"
        style={{
          // The player is now a separate flex item. Do not leave a giant
          // spacer or let a second, inaccurate reserve obscure this panel.
          paddingBottom: current ? '20px' : 'calc(24px + env(safe-area-inset-bottom, 0px))',
          background: C.bg,
        }}>
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
        {section === 'playlists' && <div className="space-y-5 px-1">
          <div className="flex items-center gap-3 px-1 py-1">
            <span className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center"
              style={{ background: '#e9e9e7', color: C.text }}>
              <UserIcon size={20} weight="regular" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold truncate" style={{ color: C.text }}>{userProfile?.name || '我的音乐空间'}</div>
              <div className="text-[11px] mt-0.5" style={{ color: C.muted }}>只属于你的收藏 · 无需平台账号</div>
            </div>
            <span className="text-[11px] tabular-nums shrink-0" style={{ color: C.muted }}>{library.playlists.length} 个歌单</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em]" style={{ color: C.text }}>我的歌单</h2>
            <span className="text-[11px]" style={{ color: C.muted }}>选择封面查看歌曲</span>
          </div>
          {library.playlists.length > 0 && <div className="music-playlist-shelf flex gap-3 overflow-x-auto pb-2 shizuku-scrollbar"
            role="group" aria-label="选择本地歌单" style={{ scrollSnapType: 'x proximity' }}>
            {library.playlists.map(pl => {
              const selected = openedPlaylist === pl.id;
              const playingThis = !!current && pl.songs.some(song => sameMusic(current, song));
              return <button key={pl.id} type="button" aria-pressed={selected}
                aria-label={`查看歌单《${pl.name}》，共 ${pl.songs.length} 首`}
                className="music-tap shrink-0 min-w-0 text-left"
                style={{ width: 'clamp(88px,22vw,128px)', scrollSnapAlign: 'start' }}
                onClick={() => { setOpenedPlaylist(selected ? null : pl.id); setEditingPlaylist(null); setDeleteConfirmPlaylistId(null); }}>
                <div className="music-playlist-cover relative w-full aspect-square overflow-hidden rounded-[17px]"
                  style={{ background: '#e7e7e5', border: selected ? '2px solid #292929' : '1px solid #e5e5e2' }}>
                  {pl.songs[0]
                    ? <VinylDisc albumPic={pl.songs[0].albumPic} picId={pl.songs[0].picId}
                        source={pl.songs[0].source} playing={playingThis} size={120} />
                    : <span className="absolute inset-0 flex items-center justify-center" style={{ color: C.muted }}>
                        <MusicNotes size={27} weight="thin" />
                      </span>}
                  <span className="absolute inset-x-0 bottom-0 py-1.5 px-2 text-[11px] font-medium text-center truncate text-white"
                    style={{ background: 'rgba(35,35,35,.63)' }}>{pl.name}</span>
                  {playingThis && <span className="absolute top-1.5 right-1.5 text-[9px] rounded-full px-1.5 py-0.5"
                    style={{ background: 'rgba(255,255,255,.94)', color: C.text }}>♫</span>}
                </div>
                <span className="block text-[10px] mt-1.5 px-1 tabular-nums" style={{ color: C.muted }}>{pl.songs.length} 首歌曲</span>
              </button>;
            })}
          </div>}
          <div className="rounded-[18px] px-3 py-2.5 flex items-center gap-2"
            style={{ background: '#fff', border: '1px solid #e9e9e7' }}>
            <input value={playlistName} onChange={e => setPlaylistName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && playlistName.trim() && createPlaylist(playlistName)) setPlaylistName(''); }}
              placeholder="给新歌单起个名字" aria-label="新歌单名称" maxLength={60}
              className="rounded-[12px] px-3 py-2.5 min-w-0 flex-1 text-xs outline-none"
              style={{ background: C.bgDeep, color: C.text }} />
            <button type="button" aria-label="新建本地歌单" title="新建歌单"
              className="music-tap w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0"
              style={{ background: C.primary }}
              onClick={() => { if (playlistName.trim() && createPlaylist(playlistName)) setPlaylistName(''); }}>
              <Plus size={17} weight="regular" />
            </button>
          </div>
          {library.playlists.filter(pl => pl.id === openedPlaylist).map(pl => {
            const playingThis = !!current && pl.songs.some(song => sameMusic(current, song));
            return <section key={pl.id} className="music-playlist-detail rounded-[22px] overflow-visible"
              aria-label={`歌单《${pl.name}》详情`}
              style={{ background: '#fff', border: '1px solid #e9e9e7' }}>
              <div className="px-4 pt-5 pb-4 flex flex-col items-center text-center">
                <div className="music-playlist-hero w-[116px] h-[116px] rounded-[19px] overflow-hidden flex items-center justify-center shrink-0"
                  style={{ background: '#efefed', border: '1px solid #e4e4e2' }}>
                  {pl.songs[0] ? <VinylDisc albumPic={pl.songs[0].albumPic} picId={pl.songs[0].picId}
                    source={pl.songs[0].source} playing={playingThis} size={116} />
                    : <MusicNotes size={36} weight="thin" color={C.muted} />}
                </div>
                <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.025em] max-w-full break-words"
                  style={{ color: C.text }}>{pl.name}</h3>
                <p className="mt-1 text-[11px]" style={{ color: C.muted }}>私人歌单 · {pl.songs.length} 首 · 仅保存在本地</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <button type="button" className="music-tap min-h-10 px-5 rounded-full text-[12px] font-medium text-white disabled:opacity-40"
                    style={{ background: C.primary }} disabled={!pl.songs.length} aria-label={`播放歌单《${pl.name}》`}
                    onClick={() => { if (pl.songs.length) void playSong(pl.songs[0], { replaceQueue: pl.songs, startIdx: 0 }); }}>
                    <span className="inline-flex items-center gap-1.5"><PlayIcon size={16} weight="fill" /> 播放歌单</span>
                  </button>
                  <button type="button" className="music-icon-press min-h-10 min-w-10 rounded-full flex items-center justify-center"
                    aria-label={`编辑歌单名称《${pl.name}》`} title="编辑歌单名称"
                    onClick={() => { setEditingPlaylist(editingPlaylist?.id === pl.id ? null : { id: pl.id, name: pl.name }); setDeleteConfirmPlaylistId(null); }}>
                    <PencilSimple size={19} color={C.muted} />
                  </button>
                  <button type="button" className="music-icon-press min-h-10 min-w-10 rounded-full flex items-center justify-center"
                    aria-label={`删除歌单《${pl.name}》`} title="删除歌单"
                    onClick={() => { setDeleteConfirmPlaylistId(deleteConfirmPlaylistId === pl.id ? null : pl.id); setEditingPlaylist(null); }}>
                    <Trash size={19} color={C.muted} />
                  </button>
                </div>
              </div>
              {editingPlaylist?.id === pl.id && <div className="mx-3 mb-3 flex gap-2 items-center">
                <input aria-label={`编辑《${pl.name}》的新名称`} autoFocus
                  value={editingPlaylist.name} maxLength={60}
                  onChange={e => setEditingPlaylist({ id: pl.id, name: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.stopPropagation(); setEditingPlaylist(null); }
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) savePlaylistName();
                  }}
                  className="flex-1 min-w-0 h-11 rounded-[12px] px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
                  style={{ background: C.bgDeep, color: C.text }} />
                <button type="button" onClick={savePlaylistName} disabled={!editingPlaylist.name.trim()}
                  className="music-tap h-11 px-3 rounded-[12px] text-xs font-medium disabled:opacity-40"
                  style={{ background: C.primary, color: '#fff' }}>保存</button>
                <button type="button" onClick={() => setEditingPlaylist(null)}
                  className="music-tap h-11 px-3 rounded-[12px] text-xs"
                  style={{ background: C.soft, color: C.muted }}>取消</button>
              </div>}
              {deleteConfirmPlaylistId === pl.id && <div className="mx-3 mb-3 rounded-[14px] px-3 py-3 flex flex-wrap items-center gap-2"
                style={{ background: C.soft }}>
                <span className="text-xs flex-1 min-w-[120px]" style={{ color: C.text }}>确定删除《{pl.name}》？不会删除已喜欢的歌曲。</span>
                <button type="button" className="music-tap min-h-11 px-3 rounded-[12px] text-xs"
                  onClick={() => setDeleteConfirmPlaylistId(null)}>取消</button>
                <button type="button" className="music-tap min-h-11 px-3 rounded-[12px] text-xs font-semibold"
                  style={{ color: '#fff', background: C.primary }}
                  onClick={() => {
                    if (deletePlaylist(pl.id)) {
                      setDeleteConfirmPlaylistId(null);
                      if (openedPlaylist === pl.id) setOpenedPlaylist(null);
                      addToast('歌单已删除', 'success');
                    }
                  }}>确认删除</button>
              </div>}
              <div className="px-3 pb-3">
                <div className="flex items-center justify-between gap-2 px-2 py-3"
                  style={{ borderTop: '1px solid #eeecea' }}>
                  <span className="text-[12px] font-semibold" style={{ color: C.text }}>歌单列表</span>
                  <span className="text-[11px]" style={{ color: C.muted }}>{pl.songs.length} 首</span>
                </div>
                {renderLibrarySongs(pl.songs, pl.id)}
              </div>
            </section>;
          })}
          {!library.playlists.length && <p className="text-xs text-center py-10" style={{ color: C.muted }}>还没有歌单，创建一个收藏喜欢的歌吧</p>}
        </div>}

      </div>
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
          onOpenQueue={() => { setQueueSheetOpen(true); trackEvent('从迷你播放器打开播放列表'); }}
          queueCount={queue.length}
          queueOpen={queueSheetOpen}
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
      <div className="music-now-playing flex flex-col h-full relative"
        style={{ background: C.bg }}>
        <BokehBg />
        <MizuHeader title="正在播放" onBack={() => setView('search')} />

        <div className="flex-1 min-h-0 flex flex-col items-center px-5 pt-3 pb-3 relative z-10 overflow-hidden">
          <div className="music-player-source shrink-0 text-[10px] tracking-[0.2em] font-medium mb-3"
            style={{ color: C.muted }}>
            {current.local ? 'LOCAL RECORDING' : current.source === 'tencent' ? 'QQ MUSIC' : 'NETEASE MUSIC'}
          </div>
          <div className="music-player-art-frame shrink-0 relative rounded-[25px] p-3.5"
            style={{ background: C.surface, border: '1px solid #ecece9', boxShadow: '0 9px 28px rgba(0,0,0,.035)' }}>
            <div className="music-player-art">
              <VinylDisc albumPic={current.albumPic} picId={current.picId} source={current.source}
                playing={playing} size={188} bitrate={actualQualityLabel} />
            </div>
            {/* 重录中覆盖层 — 只在本地歌且 regeneratingId 匹配时显示 */}
            {isCurrentRegenerating && (
              <div className="absolute inset-3 rounded-2xl flex items-center justify-center pointer-events-none"
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

          <section className="music-player-meta mt-4 text-center space-y-1.5 shrink-0 px-2 w-full max-w-full">
            <h2 className="font-semibold tracking-tight leading-snug break-words line-clamp-2"
              style={{ color: C.text, fontFamily: 'inherit', fontSize: '20px', fontWeight: 650 }}>
              {current.name}
            </h2>
            <p className="text-[12px] truncate max-w-full"
              style={{ color: C.muted, letterSpacing: '0.01em' }}>
              {current.artists}
            </p>
          </section>

          <div
            ref={lyricBoxRef}
            className="music-player-lyrics flex-1 w-full my-2 min-h-0 overflow-y-auto text-center scroll-smooth shizuku-scrollbar px-2"
            style={{ overscrollBehavior: 'contain' }}
          >
            {lyric.length === 0 ? (
              <div className="pt-6 flex flex-col items-center gap-2" style={{ color: C.faint }}>
                <Sparkle size={12} color={C.glow} />
                <span className="text-[12px]" style={{ fontFamily: 'inherit' }}>
                  {lyricMessage || (loadingSong ? '正在加载歌词…' : '暂无歌词')}
                </span>
              </div>
            ) : (
              <div className="space-y-3.5 py-5">
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
                          className="text-[15px] leading-[1.5]"
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

          <div className="shrink-0 mt-2 w-full">
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
              onOpenQueue={() => { setQueueSheetOpen(true); trackEvent('从完整播放器打开播放列表'); }}
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
          <div className="rounded-sm p-3.5 shizuku-glass" style={{ boxShadow: 'none' }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center justify-between" style={{ color: C.muted }}>
              <span className="flex items-center gap-1.5"><Sparkle size={6} color={C.glow} delay={0} /> 服务地址</span>
              {!followsCentral && (
                <button onClick={() => setDraft({ workerUrl: '' })}
                  className="text-[9px] underline" style={{ color: C.muted }}>改回跟随中心</button>
              )}
            </div>
            <input className="w-full rounded-sm px-3 py-2.5 outline-none text-xs shizuku-glass" value={cfg.workerUrl}
              onChange={e => setDraft({ workerUrl: e.target.value })} placeholder={effectiveWorkerUrl}
              style={{ color: C.text }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              {followsCentral
                ? <>跟随「设置 → 网络代理」：{effectiveWorkerUrl}</>
                : <>只在音乐里用这个地址，「设置 → 网络代理」改了也不跟</>}
            </div>
          </div>
          <div className="rounded-sm p-3.5 shizuku-glass" style={{ boxShadow: 'none' }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.sakura} delay={0.5} /> 会员 Cookie
            </div>
            <textarea className="w-full rounded-sm px-3 py-2.5 outline-none text-[11px] shizuku-glass" rows={3} value={cfg.cookie}
              onChange={e => setDraft({ cookie: e.target.value })} placeholder="MUSIC_U=xxx 或直接粘贴值..."
              style={{ color: C.text, fontFamily: 'monospace', resize: 'none' }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              也可以在「我的」页面里扫码 / 手机号登录，自动填入 cookie
            </div>
          </div>
          <div className="rounded-sm p-3.5 shizuku-glass" style={{ boxShadow: 'none' }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.lavender} delay={1} /> 音质
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const).map(q => (
                <button key={q} onClick={() => { setDraft({ quality: q }); trackEvent('切换音质档位', { quality: q }); }}
                  className="py-2.5 rounded-sm text-[10px] font-medium transition-colors"
                  style={{
                    background: cfg.quality === q ? `#171717` : C.glass,
                    color: cfg.quality === q ? 'white' : C.muted,
                    border: cfg.quality === q ? '1px solid transparent' : `1px solid rgba(230,230,230,.8)`,
                    boxShadow: 'none',
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
                lines.push(`Cookie: ${ck ? '已配置（敏感值不显示）' : '未配置'}`);
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
              className="w-full py-3 rounded-sm text-[12px] font-medium tracking-wide shizuku-glass transition-all"
              style={{ color: C.vip, border: `1px solid ${C.vip}30` }}
            >诊断（搜索晴天）</button>
            <button onClick={commit}
              className="w-full py-3.5 rounded-sm text-[13px] font-semibold text-white tracking-wide transition-colors"
              style={{ background: C.primary }}>
              保存
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="music-editorial-shell absolute inset-0 overflow-hidden">
      <div key={view} className="absolute inset-0 music-panel-enter">
        {view === 'search' && renderSearch()}
        {view === 'player' && renderPlayer()}
        {view === 'settings' && renderSettings()}
        {view === 'profile' && (
          <NeteaseProfilePage
            onBack={() => setView('search')}
            onOpenPlayer={() => setView('player')}
            onOpenQueue={() => setQueueSheetOpen(true)}
            queueOpen={queueSheetOpen}
            onOpenSearch={() => setView('search')}
            onOpenSettings={() => setView('settings')}
          />
        )}
      </div>
      {togetherSheetOpen && <MusicTogetherSheet
        people={characters.map(c => ({
          id: c.id,
          name: c.name,
          incoming: !!charInvites[c.id],
          trackName: charInvites[c.id]?.track?.name,
          active: listeningTogetherWith.includes(c.id),
          outgoing: listeningInvites[c.id],
        }))}
        onClose={() => setTogetherSheetOpen(false)}
        onAnswer={(charId, accepted) => {
          void answerCharInvite(charId, accepted);
          setTogetherSheetOpen(false);
        }}
        onInvite={charId => inviteListeningPartner(charId)}
        onCancel={charId => cancelListeningInvite(charId)}
        onEnd={charId => removeListeningPartner(charId)}
      />}
      {playlistSheetSong && <MusicPlaylistSheet
        song={playlistSheetSong} playlists={library.playlists}
        onClose={() => setPlaylistSheetSong(null)}
        onAdd={id => {
          const playlist = library.playlists.find(p => p.id === id);
          if (!playlist || !addSongToPlaylist(id, playlistSheetSong)) return false;
          addToast(`已加入《${playlist.name}》`, 'success');
          return true;
        }}
        onCreateAndAdd={name => {
          if (!createPlaylistWithSong(name, playlistSheetSong)) return false;
          addToast('新歌单已创建，歌曲已加入', 'success');
          return true;
        }}
      />}
      {queueSheetOpen && <MusicQueueSheet
        queue={queue} activeIndex={idx} playing={playing} loading={loadingSong}
        onClose={() => setQueueSheetOpen(false)}
        onSelect={(song, index) => {
          if (index === idx) { if (!loadingSong) togglePlay(); }
          else { void playSong(song); trackEvent('从播放列表选歌'); }
        }}
        onMove={moveQueueSong} onRemove={removeQueueSong}
        onClearUpcoming={clearUpcomingQueue}
      />}
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
