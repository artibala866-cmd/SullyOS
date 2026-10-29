/**
 * Sully Music / MONO — 黑白灰的克制式音乐界面。
 * 视觉装饰不得遮盖功能；封面按需加载、伴听与播放器行为保持独立。
 */
import React, { useEffect, useRef, useState } from 'react';
import { getGuestMusicCover } from '../../utils/musicArtwork';
import { ArrowLeft, X, MagnifyingGlass, Play, Pause, SkipBack, SkipForward, MusicNote, Heart } from '@phosphor-icons/react';
import { isBlobRef, useBlobRefUrl } from '../../utils/blobRef';
import TokenImg from '../../components/os/TokenImg';

export const C = {
  bg: '#f6f6f5',
  bgDeep: '#ededeb',
  bgTint: '#e5e5e3',
  primary: '#171717',
  accent: '#454545',
  soft: '#eeeeec',
  glow: '#b6b6b2',
  sakura: '#666666',
  lavender: '#8a8a87',
  surface: '#ffffff',
  glass: '#fafafa',
  text: '#171717',
  muted: '#666666',
  faint: '#999999',
  vip: '#555555',
  danger: '#303030',
} as const;

const STYLE_ID = '__sully_music_mono';
const injectStyles = () => {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@keyframes music-panel-arrive{from{opacity:.55;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes music-equalizer{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
.music-panel-enter{animation:music-panel-arrive .18s ease-out both}
.music-tap{touch-action:manipulation;transition:background-color .15s ease,color .15s ease,opacity .15s ease}
.music-editorial-shell{font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Noto Sans SC",sans-serif;color:#171717}
.music-editorial-shell ::selection{background:#171717;color:#fff}
.music-editorial-shell input::placeholder{color:#929292}
.music-editorial-shell .music-track-row{border-radius:0}
.music-editorial-shell .music-track-row:hover{background:#f4f4f3}
.music-dock{box-shadow:0 14px 42px rgba(0,0,0,.20);border:1px solid #282828}
.music-dock .music-tap:focus-visible,.music-dock .music-icon-press:focus-visible{outline-color:#fff}
.music-dock-open{min-width:0;flex:1;display:flex;align-items:center;gap:11px;text-align:left}
.music-dock-open:focus-visible{outline:2px solid #fff;outline-offset:3px}
.music-dock .music-dock-progress{background:#565656}
.music-dock .music-dock-progress>div{background:#f7f7f7}
@media(max-width:350px){.music-dock .music-dock-previous{display:none}}
@media(hover:none){.music-editorial-shell .music-track-row:hover{background:transparent}}
.music-tap:active:not(:disabled){opacity:.65}
.music-tap:focus-visible,.music-icon-press:focus-visible{outline:2px solid #171717;outline-offset:2px}
.music-icon-press{touch-action:manipulation;transition:color .15s ease,opacity .15s ease}
.music-icon-press:active:not(:disabled){opacity:.6}
.music-track-row{transition:background-color .15s ease}
.music-track-row:active{background:#eeeeec}
.music-eq{display:inline-flex;align-items:flex-end;gap:2px;height:11px;color:#171717}
.music-eq>span{width:2px;height:100%;border-radius:1px;background:currentColor;transform-origin:bottom;animation:music-equalizer .85s ease-in-out infinite}
.music-eq>span:nth-child(2){animation-delay:.18s}
.music-eq>span:nth-child(3){animation-delay:.36s}
.shizuku-glass,.shizuku-glass-strong{background:#fff;border:1px solid #e5e5e5}
.shizuku-scrollbar{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.shizuku-scrollbar::-webkit-scrollbar{width:3px}
.shizuku-scrollbar::-webkit-scrollbar-thumb{background:#c6c6c6;border-radius:4px}
@media(pointer:coarse){.shizuku-glass,.shizuku-glass-strong{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.shizuku-bokeh [style*="animation"]{animation:none!important}}
@media(prefers-reduced-motion:reduce){.music-panel-enter,.music-eq>span,.shizuku-bokeh [style*="animation"]{animation:none!important}.music-tap,.music-icon-press{transition:none!important}}
`;
  document.head.appendChild(style);
};

// Kept as compatible no-op exports: the monochrome interface has no stars.
export const Sparkle: React.FC<{ className?: string; size?: number; color?: string; delay?: number }> = () => null;
export const CrossStar: React.FC<{ className?: string; size?: number; color?: string; delay?: number; solid?: boolean }> = () => null;

export const MizuHeader: React.FC<{
  title: string;
  onBack?: () => void;
  onClose?: () => void;
  right?: React.ReactNode;
}> = ({ title, onBack, onClose, right }) => (
  <header className="flex items-center justify-between h-14 px-4 shrink-0 relative z-20"
    style={{ background: C.surface, borderBottom: '1px solid #e9e9e7', paddingTop: 'var(--safe-top)', boxSizing: 'content-box' }}>
    <button type="button" onClick={onBack || onClose}
      aria-label={onBack ? '返回上一页' : '关闭音乐应用'}
      className="music-icon-press flex items-center justify-center w-10 h-10 rounded-md"
      style={{ color: C.text }}>
      {onBack ? <ArrowLeft size={19} /> : <X size={19} />}
    </button>
    <span className="text-[13px] font-semibold tracking-[0.12em] truncate px-2" style={{ color: C.text }}>{title}</span>
    <div className="min-w-10 shrink-0 flex items-center justify-end">{right}</div>
  </header>
);

export const SearchBar: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onSearch: () => void;
  searching: boolean;
}> = ({ value, onChange, onSearch, searching }) => (
  <div className="flex gap-2 px-5 pt-3 pb-4 relative z-10" role="search">
    <div className="flex-1 min-w-0 flex items-center gap-2.5 rounded-sm px-3.5 h-12 border focus-within:border-neutral-800"
      style={{ background: '#fff', borderColor: '#d4d4d4' }}>
      <MagnifyingGlass size={18} color={C.muted} />
      <input aria-label="搜索歌曲或歌手"
        className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-neutral-400"
        style={{ color: C.text }} placeholder="歌曲、歌手或专辑"
        value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSearch(); }} />
    </div>
    <button type="button" onClick={onSearch} disabled={searching}
      className="music-tap h-12 px-6 rounded-sm text-[12px] font-semibold text-white disabled:opacity-50"
      style={{ background: C.primary }}>{searching ? '搜索中' : '搜索'}</button>
  </div>
);

/** Request a missing pic_id only when the cover is about to enter the viewport.
 * Avoid 36+ network requests on every re-render or Android WebView scroll.
 */
const useMusicCover = (albumPic: string, picId?: string, source?: 'netease' | 'tencent') => {
  const direct = useBlobRefUrl(albumPic) || '';
  const [fallback, setFallback] = useState('');
  const [near, setNear] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setFallback('');
    setNear(false);
    if (direct || !picId) return;
    const element = coverRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [albumPic, direct, picId, source]);
  useEffect(() => {
    if (!near || direct || !picId) return;
    let active = true;
    void getGuestMusicCover({ albumPic, picId, source }).then(url => {
      if (active) setFallback(url);
    });
    return () => { active = false; };
  }, [albumPic, direct, near, picId, source]);
  return { coverRef, cover: direct || fallback };
};


export const SongRow: React.FC<{
  name: string; artists: string; album: string; albumPic: string; duration: string;
  isVip: boolean; isActive: boolean; isPlaying?: boolean; isLoading?: boolean;
  picId?: string; source?: 'netease' | 'tencent'; onClick: () => void;
}> = ({ name, artists, album, albumPic, duration, isVip, isActive, isPlaying = false, isLoading = false, picId, source, onClick }) => {
  const { coverRef, cover } = useMusicCover(albumPic, picId, source);
  const status = isActive ? isLoading ? '正在加载' : isPlaying ? '播放中' : '已暂停' : '';
  return (
    <button type="button" onClick={onClick}
      aria-label={isActive && isPlaying ? `暂停《${name}》` : `播放《${name}》`}
      aria-busy={isActive && isLoading}
      className="music-tap group w-full min-w-0 flex items-center gap-3 px-2 py-2.5 text-left rounded-none"
      style={{ background: isActive ? '#f0f0ef' : 'transparent' }}>
      <div ref={coverRef} className="relative shrink-0 w-12 h-12 overflow-hidden rounded-sm"
        style={{ background: '#e6e6e5' }}>
        {cover ? <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center" style={{ color: C.muted }}><MusicNote size={20} /></div>}
        <div className="absolute inset-0 flex items-center justify-center transition-opacity"
          style={{ background: isActive || isLoading ? 'rgba(0,0,0,.42)' : 'rgba(0,0,0,.06)' }}>
          {isActive && isLoading
            ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : isActive && isPlaying
              ? <Pause size={20} color="white" weight="fill" />
              : <Play size={20} color="white" weight="fill" />}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-medium tracking-[-0.01em]" style={{ color: C.text }}>
          <span className="truncate">{name}</span>
          {isVip && <span className="text-[9px] border px-1 py-0.5 shrink-0" style={{ borderColor: '#d3d3d3', color: C.muted }}>VIP</span>}
        </div>
        <div className="text-[11px] truncate mt-1 leading-relaxed" style={{ color: C.muted }}>{artists || '未知歌手'}{album ? ` · ${album}` : ''}</div>
        {isActive && <div className="flex items-center gap-1.5 mt-1 text-[10px]" style={{ color: C.primary }}>
          {isPlaying && !isLoading ? <span className="music-eq" aria-hidden="true"><span/><span/><span/></span>
            : <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.primary }} />}
          {status}
        </div>}
      </div>
      <span className="text-[11px] shrink-0 tabular-nums" style={{ color: C.muted }}>{duration}</span>
    </button>
  );
};

const TinyAvatar: React.FC<{ avatar?: string; name: string; size?: number }> = ({ avatar, name, size = 28 }) => {
  const isImg = !!avatar && (avatar.startsWith('http') || avatar.startsWith('data:') || isBlobRef(avatar));
  const style: React.CSSProperties = { width: size, height: size, border: '1px solid #d7d7d7' };
  return isImg
    ? <TokenImg value={avatar} alt="" className="rounded-full object-cover shrink-0" style={style} />
    : <div className="rounded-full flex items-center justify-center shrink-0 font-semibold text-neutral-600"
        style={{ ...style, background: '#eeeeec', fontSize: Math.round(size * .4) }}>
        {avatar && avatar.length <= 4 ? avatar : (name || '·').slice(0, 1)}
      </div>;
};

const TogetherHeader: React.FC<{
  userAvatar?: string; userName?: string;
  companions: { id: string; name: string; avatar?: string }[];
  onKick?: (id: string) => void;
  dark?: boolean;
}> = ({ userAvatar, userName = '你', companions, onKick, dark = false }) => {
  const main = companions[0];
  return <div className="flex items-center gap-2.5" style={{ color: dark ? '#fff' : C.text }}>
    <TinyAvatar avatar={userAvatar} name={userName} size={27} />
    <span className="text-neutral-400 text-xs">/</span>
    <TinyAvatar avatar={main?.avatar} name={main?.name || ''} size={27} />
    <div className="flex-1 min-w-0">
      <div className="uppercase tracking-[0.12em] text-[9px] font-semibold" style={{ color: dark ? '#bcbcbc' : C.muted }}>Listening together</div>
      <div className="text-[11px] truncate font-medium" style={{ color: dark ? '#fff' : C.text }}>
        {userName} · {main?.name}{companions.length > 1 ? ` 等 ${companions.length} 人` : ''}
      </div>
    </div>
    {onKick && main && <button type="button" aria-label={`结束和 ${main.name} 的一起听`}
      onClick={e => { e.stopPropagation(); onKick(main.id); }}
      className="music-icon-press w-8 h-8 flex items-center justify-center" style={{ color: dark ? '#fff' : C.muted }}>
      <X size={15} />
    </button>}
  </div>;
};

export const MiniPlayer: React.FC<{
  name: string; artists: string; albumPic: string; picId?: string; source?: 'netease' | 'tencent';
  playing: boolean; loading?: boolean; progress?: number; duration?: number;
  onTap: () => void; onPrev: () => void; onToggle: () => void; onNext: () => void;
  userAvatar?: string; userName?: string;
  companions?: { id: string; name: string; avatar?: string }[];
  onKickCompanion?: (charId: string) => void;
  charsWithSong?: { id: string; name: string; playlistTitle: string }[];
  regenStatus?: string;
}> = ({ name, artists, albumPic, picId, source, playing, loading = false, progress = 0, duration = 0,
  onTap, onPrev, onToggle, onNext, userAvatar, userName, companions, onKickCompanion, charsWithSong, regenStatus }) => {
  const { coverRef, cover } = useMusicCover(albumPic, picId, source);
  const pct = duration > 0 ? Math.min(100, Math.max(0, progress / duration * 100)) : 0;
  return <div className="music-dock absolute left-3 right-3 bottom-3 z-30 rounded-lg px-3.5 py-3"
    style={{ background: '#171717', color: '#fff', bottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}>
    {companions && companions.length > 0 && <div className="mb-2.5 pb-2 border-b border-neutral-700">
      <TogetherHeader userAvatar={userAvatar} userName={userName} companions={companions} onKick={onKickCompanion} dark />
    </div>}
    <div className="flex items-center gap-2 min-w-0">
      <button type="button" onClick={onTap} aria-label={`打开《${name}》的完整播放器`}
        className="music-dock-open music-tap">
        <div ref={coverRef} className="relative shrink-0 w-11 h-11 rounded-sm overflow-hidden" style={{ background: '#383838' }}>
          {cover ? <img src={cover} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><MusicNote size={19} color="#d0d0d0" /></div>}
          {regenStatus && <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>}
        </div>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-[13px] font-semibold tracking-[-0.01em] text-white">{name}</span>
          <span className="block truncate text-[11px] mt-1" style={{ color: '#bdbdbd' }}>
            {regenStatus ? regenStatus : loading ? '正在获取音源…' : artists}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-0 shrink-0">
        <button type="button" aria-label="上一首" onClick={onPrev}
          className="music-dock-previous music-icon-press w-9 h-10 flex items-center justify-center" style={{ color: '#d4d4d4' }}><SkipBack size={18} weight="fill" /></button>
        <button type="button" onClick={onToggle}
          aria-label={loading ? '正在加载音频' : playing ? '暂停' : '播放'}
          className="music-tap w-10 h-10 rounded-full flex items-center justify-center" style={{ background: '#fff' }}>
          {loading ? <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            : playing ? <Pause size={18} color="#171717" weight="fill" /> : <Play size={18} color="#171717" weight="fill" />}
        </button>
        <button type="button" aria-label="下一首" onClick={onNext}
          className="music-icon-press w-9 h-10 flex items-center justify-center" style={{ color: '#d4d4d4' }}><SkipForward size={18} weight="fill" /></button>
      </div>
    </div>
    <div className="music-dock-progress h-[2px] mt-3 overflow-hidden" aria-hidden="true">
      <div className="h-full transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
    {(!companions || companions.length === 0) && charsWithSong && charsWithSong.length > 0 &&
      <div className="mt-2 text-[10px] truncate" style={{ color: '#bdbdbd' }}>
        {charsWithSong[0].name} 的《{charsWithSong[0].playlistTitle}》里也有
      </div>}
  </div>;
};

// Same public component contract; render a square editorial album cover instead
// of a spinning vinyl record and floating sparkles.
export const VinylDisc: React.FC<{
  albumPic: string; picId?: string; source?: 'netease' | 'tencent';
  playing: boolean; size?: number; bitrate?: string;
}> = ({ albumPic, picId, source, size = 180, bitrate }) => {
  const { coverRef, cover } = useMusicCover(albumPic, picId, source);
  return <div ref={coverRef} className="relative" style={{ width: size, height: size }}>
    <div className="w-full h-full rounded-md overflow-hidden"
      style={{ background: '#e6e6e4', border: '1px solid #dededc', boxShadow: '0 12px 30px rgba(0,0,0,.10)' }}>
      {cover ? <img src={cover} alt="专辑封面" className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"><MusicNote size={size * .27} color={C.muted} weight="thin" /></div>}
    </div>
    {bitrate && <div className="absolute bottom-2 left-2 right-2 px-1.5 py-1 rounded-sm text-[9px] text-center leading-tight"
      style={{ color: '#fff', background: 'rgba(0,0,0,.72)' }}>{bitrate}</div>}
  </div>;
};

export const MetaChip: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) =>
  <span className={`text-[10px] tabular-nums font-medium ${className}`} style={{ color: C.muted }}>{children}</span>;

export type SubPlayMode = 'loop' | 'single' | 'shuffle';
export const SubActions: React.FC<{
  onLike?: () => void; liked?: boolean; onSync?: () => void; showSync?: boolean;
  onDownload?: () => void; showDownload?: boolean;
  playMode?: SubPlayMode; onCyclePlayMode?: () => void; onAdd?: () => void;
}> = ({ onLike, liked, onSync, showSync, onDownload, showDownload, playMode = 'loop', onCyclePlayMode, onAdd }) => {
  const Item = ({ label, glyph, onClick, active }: { label: string; glyph: React.ReactNode; onClick?: () => void; active?: boolean }) =>
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active}
      className="music-icon-press flex flex-col items-center justify-center min-w-12 gap-1 py-1"
      style={{ color: active ? C.primary : C.muted }}>
      <span className="h-6 flex items-center justify-center">{glyph}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>;
  const modeLabel = playMode === 'single' ? '单曲循环' : playMode === 'shuffle' ? '随机播放' : '列表循环';
  return <div className="flex items-center justify-around gap-2 max-w-[340px] mx-auto border-t pt-3" style={{ borderColor: '#e6e6e6' }}>
    {onLike && <Item label={liked ? '已喜欢' : '喜欢'} glyph={<Heart size={16} weight={liked ? 'fill' : 'regular'} />} active={liked} onClick={onLike} />}
    {showSync && onSync && <Item label="歌词对轴" glyph={<span className="text-lg">⌖</span>} onClick={onSync} />}
    {showDownload && onDownload && <Item label="下载" glyph={<span className="text-lg">↓</span>} onClick={onDownload} />}
    {onCyclePlayMode && <Item label={modeLabel} glyph={<span className="text-lg">{playMode === 'shuffle' ? '⤨' : playMode === 'single' ? '↻¹' : '↻'}</span>}
      active={playMode !== 'loop'} onClick={onCyclePlayMode} />}
    {onAdd && <Item label="加入队列" glyph={<span className="text-lg">＋</span>} onClick={onAdd} />}
  </div>;
};

export const GlassProgress: React.FC<{
  progress: number; duration: number; fmtTime: (s: number) => string;
  onSeek: (pct: number) => void;
}> = ({ progress, duration, fmtTime, onSeek }) => {
  const pct = duration > 0 ? Math.min(100, Math.max(0, progress / duration * 100)) : 0;
  return <div className="w-full">
    <div className="h-5 flex items-center cursor-pointer touch-none" role="slider" tabIndex={0}
      aria-label="播放进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      onKeyDown={e => { if (e.key === 'ArrowRight') onSeek(Math.min(1, pct / 100 + .05));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, pct / 100 - .05)); }}
      onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); if (rect.width) onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))); }}>
      <div className="relative w-full h-[3px] rounded-full" style={{ background: '#d7d7d7' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: C.primary }} />
        <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-white"
          style={{ left: `${pct}%`, transform: 'translate(-50%, -50%)', background: C.primary }} />
      </div>
    </div>
    <div className="flex items-center justify-between text-[10px] tabular-nums" style={{ color: C.muted }}>
      <span>{fmtTime(progress)}</span><span>{fmtTime(duration)}</span>
    </div>
  </div>;
};

export const PlayControls: React.FC<{
  playing: boolean; loading: boolean; onPrev: () => void; onToggle: () => void; onNext: () => void;
}> = ({ playing, loading, onPrev, onToggle, onNext }) =>
  <div className="flex items-center justify-center gap-10 mt-3 mb-2">
    <button type="button" aria-label="上一首" onClick={onPrev} className="music-icon-press p-2" style={{ color: C.text }}>
      <SkipBack size={24} weight="fill" /></button>
    <button type="button" onClick={onToggle} aria-label={loading ? '正在加载音频' : playing ? '暂停' : '播放'}
      className="music-tap w-[58px] h-[58px] rounded-full flex items-center justify-center"
      style={{ background: C.primary }}>
      {loading ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        : playing ? <Pause size={24} color="white" weight="fill" /> : <Play size={24} color="white" weight="fill" />}
    </button>
    <button type="button" aria-label="下一首" onClick={onNext} className="music-icon-press p-2" style={{ color: C.text }}>
      <SkipForward size={24} weight="fill" /></button>
  </div>;

export const BokehBg: React.FC = () => {
  useEffect(() => { injectStyles(); }, []);
  // No animated particles, colored halos, or decorative overlays in MONO.
  return <div className="shizuku-bokeh absolute inset-0 pointer-events-none" aria-hidden="true" />;
};
