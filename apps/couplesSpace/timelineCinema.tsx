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
  onFilter: (filter: string) => void;
  busy: boolean;
  tools?: React.ReactNode;
  onNew: () => void;
  onAI: () => void;
  onJump: (id: string) => void;
};

const sprockets = Array.from({ length: 11 }, (_, index) => index);

/**
 * One reel, two physical viewing surfaces. The winding strip is decorative;
 * its individual selectable frames always come from actual saved entries.
 * No fabricated moments or background API requests.
 */
export function TimelineCinema({ bond, names, rows, today, initialFocusId, filter, onFilter, busy, tools, onNew, onAI, onJump }: TimelineCinemaProps) {
  const [focusedId, setFocusedId] = useState<string | undefined>(initialFocusId);
  const [turn, setTurn] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const skipClick = useRef(false);
  const filmStrip = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, rows.findIndex(item => item.id === focusedId));
  const selected = rows[selectedIndex];
  const focusedImage = selected?.images?.[0] || selected?.image;
  const isHandbook = filter === 'handbook';

  useLayoutEffect(() => {
    if (!initialFocusId || !filmStrip.current) return;
    const index = rows.findIndex(item => item.id === initialFocusId);
    const reel = filmStrip.current;
    const frame = index < 0 ? null : reel.children.item(index) as HTMLElement | null;
    if (frame) reel.scrollLeft = frame.offsetLeft - reel.offsetLeft - (reel.clientWidth - frame.offsetWidth) / 2;
  }, [initialFocusId]);

  const chooseFrame = (index: number) => {
    if (!rows.length || busy) return;
    const next = (index + rows.length) % rows.length;
    setDirection(next >= selectedIndex ? 'forward' : 'backward');
    setTurn(value => value + 1);
    setFocusedId(rows[next].id);
    const target = filmStrip.current?.children.item(next);
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };
  const chooseMode = (next: 'all' | 'handbook') => {
    if (busy || (next === 'handbook') === isHandbook) return;
    setDirection(next === 'handbook' ? 'forward' : 'backward');
    setTurn(value => value + 1);
    onFilter(next);
  };
  const touchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    if (point) swipe.current = { x: point.clientX, y: point.clientY };
    skipClick.current = false;
  };
  const touchMove = (event: React.TouchEvent) => {
    const start = swipe.current;
    const point = event.touches[0];
    if (!start || !point) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.25) setDragX(Math.max(-95, Math.min(95, dx)));
  };
  const touchEnd = (event: React.TouchEvent, area: 'stage' | 'mode') => {
    setDragX(0);
    const start = swipe.current;
    swipe.current = null;
    const point = event.changedTouches[0];
    if (!start || !point) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    skipClick.current = true;
    if (area === 'mode' || rows.length < 2) {
      chooseMode(dx < 0 ? 'handbook' : 'all');
    } else if (isHandbook) {
      chooseMode(dx < 0 ? 'all' : 'handbook');
    } else {
      chooseFrame(selectedIndex + (dx < 0 ? 1 : -1));
    }
  };

  return <section className={'couple-cinema couple-cinema-v2'+(isHandbook?' is-handbook':'')} aria-label="牵绊时光 · 记忆放映室">
    <header className="couple-cinema-v2-head">
      <div className="couple-cinema-v2-names">{names.me}<span> / </span>{names.them}</div>
      <h2>牵绊时光</h2>
      <div className="couple-cinema-v2-count">{rows.length} <span>幕</span><i/> {bond.start.slice(0,4)}—{today.slice(0,4)}</div>
    </header>

    <div className="couple-cinema-v2-scene" style={{ '--cinema-drag-x': `${dragX}px` } as React.CSSProperties}>
      <div className="couple-cinema-v2-halo" aria-hidden="true"/>
      <svg className="couple-cinema-v2-ribbon" viewBox="0 0 400 480" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="cinema-film-face" x1="0" y1="0" x2=".8" y2="1">
            <stop offset="0" stopColor="#747882"/><stop offset=".29" stopColor="#2b2e39"/>
            <stop offset=".54" stopColor="#07080c"/><stop offset=".78" stopColor="#595c69"/><stop offset="1" stopColor="#0c0d12"/>
          </linearGradient>
          <linearGradient id="cinema-film-return" x1="0" y1="0" x2="1" y2=".6">
            <stop stopColor="#0b0c12"/><stop offset=".44" stopColor="#666b77"/><stop offset=".61" stopColor="#20232d"/><stop offset="1" stopColor="#07080b"/>
          </linearGradient>
          <filter id="cinema-soft-edge"><feGaussianBlur stdDeviation="15"/></filter>
        </defs>
        <path d="M-36 203 C48 55 119 76 184 114 S333 144 440 13 L440 90 C342 222 247 217 168 177 S60 132 -36 292Z" fill="url(#cinema-film-return)" opacity=".74"/>
        <path d="M-36 211 C49 63 120 83 184 122 S335 152 440 21" fill="none" stroke="#d5d7df" strokeWidth="2" opacity=".4"/>
        <path d="M-25 268 C57 147 116 148 176 179 S335 223 433 92" fill="none" stroke="#090a10" strokeWidth="7" strokeDasharray="11 9" opacity=".8"/>
        <path d="M-36 412 C60 320 138 322 201 369 S328 426 440 298 L440 386 C323 497 253 476 186 429 S57 388 -36 482Z" fill="url(#cinema-film-face)"/>
        <path d="M-36 416 C60 324 138 328 201 374 S328 430 440 303" fill="none" stroke="#c9cbd3" strokeWidth="2" opacity=".5"/>
        <path d="M-36 468 C60 377 138 380 199 425 S328 478 440 359" fill="none" stroke="#05060a" strokeWidth="7" strokeDasharray="12 10" opacity=".9"/>
        <path d="M-36 438 C60 344 138 350 201 400 S328 454 440 333" fill="none" stroke="#babdc9" strokeWidth="1" opacity=".25"/>
      </svg>

      <div className="couple-cinema-v2-sidefilm sidefilm-left" aria-hidden="true">
        {sprockets.map(i=><span key={i}><i/></span>)}
      </div>
      <div className="couple-cinema-v2-sidefilm sidefilm-right" aria-hidden="true">
        {sprockets.map(i=><span key={i}><i/></span>)}
      </div>

      <div className="couple-cinema-v2-deck" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={event=>touchEnd(event,'stage')} onTouchCancel={()=>{swipe.current=null;setDragX(0);}}>
        <div className="couple-cinema-v2-deck-top">
          <span className="couple-cinema-v2-gate-dot"/><span>{isHandbook ? 'MEMORY BOOK' : 'MEMORY REEL'}</span>
          <span>{String(selected ? selectedIndex+1:0).padStart(2,'0')} / {String(rows.length).padStart(2,'0')}</span>
        </div>
        <div className="couple-cinema-v2-gate" key={turn+'-'+(selected?.id??'empty')+'-'+filter} data-direction={direction}>
          <div className="couple-cinema-v2-edge edge-top" aria-hidden="true">{sprockets.map(i=><i key={i}/>)}</div>
          {isHandbook ? <div className="couple-cinema-v2-paper">
            <div className="couple-cinema-v2-paper-hole" aria-hidden="true">{Array.from({length:5},(_,i)=><i key={i}/>)}</div>
            <div className="couple-cinema-v2-paper-main">
              <span className="couple-cinema-v2-paper-kicker">{bond.start.slice(0,4)} / OUR NOTES</span>
              <strong>我们的手账</strong>
              <div className="couple-cinema-v2-paper-list">
                {rows.slice(0,3).map((item,i)=><button key={item.id} type="button" disabled={busy} onClick={()=>{if(skipClick.current){skipClick.current=false;return;}onJump(item.id);}}>
                  <time>{String(i+1).padStart(2,'0')} · {item.date.slice(5).replace('-', '.')}</time>
                  <span>{item.title}</span>
                </button>)}
                {!rows.length && <div className="couple-cinema-v2-paper-empty">
                  <div className="couple-cinema-v2-ink-line"/><div className="couple-cinema-v2-ink-line"/>
                  <small>第一页，还没有写下故事</small>
                </div>}
              </div>
            </div>
            <div className="couple-cinema-v2-paper-fold" aria-hidden="true"/>
          </div> : selected ? <button type="button" className="couple-cinema-v2-memory" disabled={busy} onClick={() => {if(skipClick.current){skipClick.current=false;return;}onJump(selected.id);}}>
            {focusedImage ? <TokenImg value={focusedImage} alt="" className="couple-cinema-v2-image"/>:
              <div className="couple-cinema-v2-photoless"><div className="couple-cinema-v2-photoless-iris"/><span>✧</span></div>}
            <div className="couple-cinema-v2-caption">
              <time>{selected.date}{selected.time ? ' · '+selected.time.slice(0,5) : ''}</time>
              <strong>{selected.title}</strong>
              {selected.body && <small>{selected.body}</small>}
            </div>
          </button> : <div className="couple-cinema-v2-leader">
            <div className="couple-cinema-v2-leader-glow"/>
            <div className="couple-cinema-v2-leader-loop" aria-hidden="true"><span/><span/><span/></div>
            <div className="couple-cinema-v2-leader-mark">Ⅰ</div>
            <button type="button" disabled={busy} onClick={onNew} className="couple-cinema-v2-first">＋ 记录第一幕</button>
          </div>}
          <div className="couple-cinema-v2-edge edge-bottom" aria-hidden="true">{sprockets.map(i=><i key={i}/>)}</div>
        </div>
        <div className="couple-cinema-v2-transport">
          <button type="button" aria-label="上一段回忆" disabled={busy || rows.length < 2} onClick={()=>chooseFrame(selectedIndex-1)}>‹</button>
          <span className="couple-cinema-v2-transport-track"><i/><b/><i/></span>
          <button type="button" aria-label="下一段回忆" disabled={busy || rows.length < 2} onClick={()=>chooseFrame(selectedIndex+1)}>›</button>
        </div>
      </div>
    </div>

    <nav className="couple-cinema-v2-modes" aria-label="回忆观看方式"
      onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={event=>touchEnd(event,'mode')} onTouchCancel={()=>{swipe.current=null;setDragX(0);}}>
      <button type="button" aria-current={!isHandbook?'page':undefined} disabled={busy} onClick={()=>chooseMode('all')}>
        <span className="couple-cinema-v2-mode-icon"><i/><i/><i/></span><strong>旅程</strong>
      </button>
      <span className="couple-cinema-v2-mode-bridge" aria-hidden="true"><i/></span>
      <button type="button" aria-current={isHandbook?'page':undefined} disabled={busy} onClick={()=>chooseMode('handbook')}>
        <span className="couple-cinema-v2-mode-icon book"><i/><i/><i/></span><strong>手账</strong>
      </button>
      <span className="couple-cinema-v2-mode-hint">左右滑动切换</span>
    </nav>

    {rows.length>0 && <div className="couple-cinema-v2-browser">
      <div className="couple-cinema-v2-browser-top"><span>{isHandbook?'手账目录':'胶片长卷'} <small>{rows.length} 段</small></span>
        <button type="button" onClick={onNew} disabled={busy} aria-label="新增回忆">＋</button></div>
      {isHandbook ? <div className="couple-cinema-v2-entries">
        {rows.map((item,index)=><button type="button" key={item.id} disabled={busy} onClick={()=>onJump(item.id)}>
          <time>{String(index+1).padStart(2,'0')} · {item.date}</time><strong>{item.title}</strong>
          <span>{item.timelineTag || names[item.side]} ↗</span>
        </button>)}
      </div> : <div className="couple-cinema-v2-filmrail" role="group" ref={filmStrip} aria-label="横向滑动胶片，选择回忆">
        {rows.map((item,index)=><button key={item.id} type="button" className={'couple-cinema-v2-cell'+(index===selectedIndex?' selected':'')}
          aria-pressed={index===selectedIndex} disabled={busy} onClick={()=>chooseFrame(index)}>
          <span className="couple-cinema-v2-cell-holes" aria-hidden="true">{Array.from({length:4},(_,i)=><i key={i}/>)}</span>
          <span className="couple-cinema-v2-cell-image">{(item.images?.[0] || item.image) ?
            <TokenImg value={(item.images?.[0] || item.image)!} alt=""/>:<span>✧</span>}</span>
          <span className="couple-cinema-v2-cell-date">{item.date.slice(5).replace('-', '.')}</span>
          <span className="couple-cinema-v2-cell-holes" aria-hidden="true">{Array.from({length:4},(_,i)=><i key={i}/>)}</span>
        </button>)}
      </div>}
    </div>}

    <footer className="couple-cinema-v2-bottom">
      <button type="button" disabled={busy} className="couple-cinema-v2-narrate" onClick={onAI}>
        <span className="couple-cinema-v2-narrate-icon">◌</span><span>听 {names.them} 讲述</span><span>↗</span>
      </button>
      <div className="couple-cinema-v2-tools">{tools}</div>
    </footer>
  </section>;
}
