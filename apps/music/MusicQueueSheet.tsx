/**
 * The real MusicProvider queue, opened from the right side of the mini-player
 * or the full player. It is a bottom sheet, not another navigation destination.
 */
import React, { useEffect, useRef, useState } from 'react';
import { DotsThreeVertical, List, Trash, X } from '@phosphor-icons/react';
import type { Song } from '../../context/MusicContext';
import { musicKey } from '../../utils/musicLibrary';
import { C, SongRow } from './MusicUI';

const durationText = (seconds: number) =>
  Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
    : '0:00';

export const MusicQueueSheet: React.FC<{
  queue: Song[];
  activeIndex: number;
  playing: boolean;
  loading: boolean;
  onSelect: (song: Song, index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onClearUpcoming: () => void;
  onClose: () => void;
}> = ({ queue, activeIndex, playing, loading, onSelect, onMove, onRemove, onClearUpcoming, onClose }) => {
  const [visibleCount, setVisibleCount] = useState(48);
  const [confirmClear, setConfirmClear] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const active = queue[activeIndex];
  return <div className="absolute inset-0 z-[60] flex flex-col justify-end" onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  }}>
    <button type="button" className="absolute inset-0 bg-black/45"
      aria-label="关闭播放列表" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-labelledby="music-queue-title"
      className="relative flex flex-col w-full rounded-t-2xl overflow-hidden music-panel-enter shadow-[0_-12px_40px_rgba(0,0,0,.24)]"
      style={{ maxHeight: 'min(80dvh, 740px)', background: '#fff', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="w-10 h-1 rounded-full shrink-0 self-center mt-3 mb-2" style={{ background: '#d1d1d1' }} aria-hidden="true" />
      <div className="shrink-0 px-5 py-2 border-b flex items-center justify-between gap-3" style={{ borderColor: '#eeeeed' }}>
        <div className="min-w-0">
          <h2 id="music-queue-title" className="text-[15px] font-semibold flex items-center gap-2" style={{ color: C.text }}>
            <List size={19} /> 播放列表 <span className="text-xs font-normal" style={{ color: C.muted }}>{queue.length} 首</span>
          </h2>
          <p className="text-[11px] mt-1 truncate" style={{ color: C.muted }}>
            {active ? `正在听：${active.name}` : '还没有选择歌曲'}
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose}
          aria-label="关闭播放列表" title="关闭"
          className="music-icon-press shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
          style={{ background: C.soft, color: C.text }}><X size={20} /></button>
      </div>

      <div className="shrink-0 flex items-center justify-between px-5 py-2 text-[11px] border-b" style={{ color: C.muted, borderColor: '#f1f1f1' }}>
        <span>点击歌曲切换 · 右侧可整理顺序</span>
        {queue.length > (active ? 1 : 0) && (
          confirmClear
            ? <span className="flex items-center gap-2">
                <span>清空待播？</span>
                <button type="button" className="music-tap px-2 py-2 font-semibold" onClick={() => setConfirmClear(false)}>取消</button>
                <button type="button" className="music-tap px-2 py-2 font-semibold" style={{ color: C.primary }}
                  onClick={() => { onClearUpcoming(); setConfirmClear(false); }}>确定</button>
              </span>
            : <button type="button" className="music-tap flex items-center gap-1 px-2 py-2 shrink-0"
                aria-label="清空待播歌曲" onClick={() => setConfirmClear(true)}><Trash size={14} /> 清空待播</button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto shizuku-scrollbar overscroll-contain px-3 pb-4"
        role="list" aria-label="当前播放队列">
        {queue.slice(0, visibleCount).map((song, index) => {
          const selected = index === activeIndex;
          return <div role="listitem" key={musicKey(song)} className="border-b" style={{
            borderColor: '#ededed', background: selected ? '#f1f1f0' : '#fff',
          }}>
            <div className="flex items-center min-w-0 gap-1">
              <div className="min-w-0 flex-1">
                <SongRow name={song.name} artists={song.artists} album={song.album}
                  albumPic={song.albumPic} picId={song.picId} source={song.source}
                  duration={durationText(song.duration)} isVip={song.fee === 1}
                  isActive={selected} isPlaying={selected && playing} isLoading={selected && loading}
                  onClick={() => onSelect(song, index)} />
              </div>
              <div className="relative w-11 h-11 shrink-0 flex items-center justify-center" style={{ color: C.muted }}>
                <DotsThreeVertical size={22} aria-hidden="true" />
                <select className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  aria-label={`整理播放列表《${song.name}》`} title="调整顺序或移除"
                  value="" onChange={e => {
                    if (e.target.value === 'up') onMove(index, index - 1);
                    if (e.target.value === 'down') onMove(index, index + 1);
                    if (e.target.value === 'remove') onRemove(index);
                  }}>
                  <option value="">整理歌曲</option>
                  <option value="up" disabled={index === 0}>上移一首</option>
                  <option value="down" disabled={index === queue.length - 1}>下移一首</option>
                  <option value="remove" disabled={selected}>从列表移除</option>
                </select>
              </div>
            </div>
            {selected && <p className="text-[10px] pl-14 -mt-1 pb-2 font-medium"
              style={{ color: C.primary }}>{loading ? '正在加载…' : playing ? '♪ 正在播放' : '已暂停'}</p>}
          </div>;
        })}
        {queue.length === 0 && <div className="py-14 text-center text-sm" style={{ color: C.muted }}>
          播放列表还是空的，搜索歌曲后就能加入
        </div>}
        {queue.length > visibleCount && <button type="button"
          className="music-tap w-full py-4 text-xs font-medium"
          style={{ color: C.primary }} onClick={() => setVisibleCount(n => n + 48)}>
          显示更多歌曲 · 还有 {queue.length - visibleCount} 首
        </button>}
      </div>
    </section>
  </div>;
};
