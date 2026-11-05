import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Bond, Entry, Side } from '../../utils/couplesSpace';
import TokenImg from '../../components/os/TokenImg';

type TimelineCinemaProps = {
  bond: Bond;
  names: Record<Side, string>;
  rows: Entry[];
  today: string;
  initialFocusId?: string;
  filter: string;
  busy: boolean;
  tools?: React.ReactNode;
  onNew: () => void;
  onAI: () => void;
  onJump: (id: string) => void;
};

/** The film frames are the actual stored moments, not decorative or invented entries. */
export function TimelineCinema({ bond, names, rows, today, initialFocusId, filter, busy, tools, onNew, onAI, onJump }: TimelineCinemaProps) {
  const [focusedId, setFocusedId] = useState<string | undefined>(initialFocusId);
  const touchStart = useRef<number | null>(null);
  const didSwipe = useRef(false);
  const filmStrip = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, rows.findIndex(item => item.id === focusedId));
  const selected = rows[selectedIndex];
  useLayoutEffect(() => {
    if (!initialFocusId || !filmStrip.current) return;
    const index = rows.findIndex(item => item.id === initialFocusId);
    const reel = filmStrip.current;
    const frame = index < 0 ? null : reel.children.item(index) as HTMLElement | null;
    if (frame) reel.scrollLeft = frame.offsetLeft - reel.offsetLeft - (reel.clientWidth - frame.offsetWidth) / 2;
  }, [initialFocusId]);
  const focusedImage = selected?.images?.[0] || selected?.image;
  const changeFrame = (index: number) => {
    if (!rows.length) return;
    const next = (index + rows.length) % rows.length;
    setFocusedId(rows[next].id);
    const target = filmStrip.current?.children.item(next);
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };
  const finishSwipe = (endX?: number) => {
    if (touchStart.current === null || endX === undefined) return;
    const dx = endX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(dx) < 46) return;
    didSwipe.current = true;
    changeFrame(selectedIndex + (dx < 0 ? 1 : -1));
  };
  return <section className="couple-cinema" aria-label="牵绊时光 · 记忆放映室">
    <header className="couple-cinema-intro">
      <div className="couple-cinema-ident"><span className="couple-cinema-eye" aria-hidden="true"><i /></span>
        <span>PRIVATE SCREENING</span></div>
      <div className="couple-cinema-names">{names.me} <span>×</span> {names.them}</div>
      <h2>牵绊时光</h2>
      <div className="couple-cinema-serial"><span>{String(rows.length).padStart(2, '0')} FRAMES</span><span>{bond.start.slice(0, 4)} — {today.slice(0, 4)}</span></div>
    </header>
    <div className="couple-cinema-projector">
      <div className="couple-cinema-screen-label"><span>NOW SHOWING</span><span>{selected ? String(selectedIndex + 1).padStart(2, '0') + ' / ' + String(rows.length).padStart(2, '0') : '00 / 00'}</span></div>
      <div className="couple-cinema-film-top" aria-hidden="true">{Array.from({length:14},(_,i)=><i key={i}/>)}</div>
      <div className="couple-cinema-viewport"
        onTouchStart={event => { touchStart.current = event.touches[0]?.clientX ?? null; didSwipe.current = false; }}
        onTouchEnd={event => finishSwipe(event.changedTouches[0]?.clientX)}
        onTouchCancel={() => { touchStart.current = null; }}>
        {selected ? <button type="button" key={selected.id} className={'couple-cinema-picture' + (focusedImage ? ' has-photo' : ' is-typeset')}
          disabled={busy} onClick={() => { if (didSwipe.current) { didSwipe.current = false; return; } onJump(selected.id); }}
          aria-label={'打开回忆：' + selected.title}>
          {focusedImage && <TokenImg value={focusedImage} alt={selected.title} className="couple-cinema-image"/>}
          {!focusedImage && <div className="couple-cinema-typeset" aria-hidden="true"><span className="couple-cinema-typeset-orbit"/><span className="couple-cinema-typeset-date">{selected.date.slice(0,4)} / {selected.date.slice(5).replace('-', '.')}</span><span className="couple-cinema-typeset-star">✧</span></div>}
          <span className="couple-cinema-shot-caption">
            <time>{selected.date}{selected.time ? ' · '+selected.time.slice(0,5) : ''}</time>
            <strong>{selected.title}</strong>
            {selected.body?.trim() && <small>{selected.body}</small>}
          </span>
        </button> : <div className="couple-cinema-empty">
          <div className="couple-cinema-aperture" aria-hidden="true"><span>✧</span></div>
          <time>{bond.start}</time>
          <strong>故事从这里开始</strong>
          <button type="button" disabled={busy} onClick={onNew}>＋ 拍下第一帧</button>
        </div>}
      </div>
      <div className="couple-cinema-film-bottom" aria-hidden="true">{Array.from({length:14},(_,i)=><i key={i}/>)}</div>
      <div className="couple-cinema-player">
        <button type="button" className="couple-cinema-arrow" disabled={busy || rows.length < 2} onClick={() => changeFrame(selectedIndex - 1)} aria-label="上一帧">‹</button>
        <button type="button" className="couple-cinema-play" disabled={busy || !selected} onClick={() => selected && onJump(selected.id)}>{selected ? '观看这一帧 ↗' : '放映待开始'}</button>
        <button type="button" className="couple-cinema-arrow" disabled={busy || rows.length < 2} onClick={() => changeFrame(selectedIndex + 1)} aria-label="下一帧">›</button>
      </div>
    </div>

    {rows.length > 0 && <>
    <div className="couple-cinema-reel-heading">
      <span>THE REEL <i/> {filter === 'handbook' ? '手账索引' : '轻触胶片切换回忆'}</span>
      <button type="button" disabled={busy} onClick={onNew} aria-label="写下新回忆">＋</button>
    </div>
    {filter === 'handbook' ? <div className="couple-cinema-index">
      {rows.map((item,index)=><React.Fragment key={item.id}>
        {rows[index-1]?.date !== item.date && <time>{item.date}</time>}
        <button type="button" disabled={busy} onClick={() => { setFocusedId(item.id); onJump(item.id); }}>
          <span className="couple-cinema-index-count">{String(index+1).padStart(2,'0')}</span>
          <span className="couple-cinema-index-copy"><strong>{item.title}</strong><small>{item.time?.slice(0,5) || names[item.side]}{item.timelineTag ? ' · '+item.timelineTag : ''}</small></span>
          {(item.images?.[0] || item.image) && <TokenImg value={(item.images?.[0] || item.image)!} alt=""/>}
          <span aria-hidden="true">↗</span>
        </button>
      </React.Fragment>)}
      {!rows.length && <span className="couple-cinema-index-start">{bond.start} · 起点</span>}
    </div> : <div ref={filmStrip} className="couple-cinema-reel" role="group" aria-label="可横向滑动的记忆胶片">
      {rows.map((item,index)=><button type="button" key={item.id} className={'couple-cinema-frame'+(index===selectedIndex?' active':'')}
        aria-pressed={index===selectedIndex} disabled={busy} onClick={event => { setFocusedId(item.id); event.currentTarget.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'}); }}>
        <span className="couple-cinema-perfs" aria-hidden="true"><i/><i/><i/><i/><i/></span>
        <span className="couple-cinema-frame-screen">{(item.images?.[0]||item.image) ? <TokenImg value={(item.images?.[0]||item.image)!} alt=""/> : <span className="couple-cinema-frame-glyph">✧</span>}</span>
        <span className="couple-cinema-frame-date">{item.date.slice(5).replace('-', '.')}</span>
        <span className="couple-cinema-frame-title">{item.title}</span>
        <span className="couple-cinema-perfs" aria-hidden="true"><i/><i/><i/><i/><i/></span>
      </button>)}
    </div>}
    </>}
    <footer className="couple-cinema-controls">
      <button type="button" className="couple-cinema-narrate" disabled={busy} onClick={onAI}><span aria-hidden="true">◉</span> 听 {names.them} 讲述</button>
      <div className="couple-cinema-tools">{tools}</div>
    </footer>
  </section>;
}
