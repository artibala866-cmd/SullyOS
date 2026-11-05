import React, { useEffect, useRef, useState } from 'react';
import type { Bond, Entry, Side } from '../../utils/couplesSpace';
import { wishCategories, wishTags } from '../../utils/couplesSpace';

type WishConstellationProps = {
  bond: Bond;
  names: Record<Side, string>;
  rows: Entry[];
  allCount: number;
  filter: string;
  busy: boolean;
  focusRecordId?: string;
  glowingRecordId?: string;
  onFilter: (category: string) => void;
  onNew: () => void;
  onAI: () => void;
  onOpen: (id: string) => void;
  onToggleDone: (entry: Entry) => void;
};
const STAR_POSITIONS = [
  { x: 80, y: 134 }, { x: 211, y: 88 }, { x: 326, y: 185 }, { x: 235, y: 266 },
  { x: 80, y: 331 }, { x: 163, y: 422 }, { x: 307, y: 407 }, { x: 347, y: 66 },
];
const ambient = [
  [12,10,1],[24,21,.6],[39,4,.8],[61,19,.8],[85,13,.7],[95,30,.6],
  [8,42,.6],[26,54,.8],[52,40,.5],[90,49,.7],[16,75,.7],[37,89,.65],
  [67,74,.8],[84,92,.6],[93,72,.6],[56,97,.7],
] as const;
const PAGE_SIZE = STAR_POSITIONS.length;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function stepCompletion(item: Entry) {
  const steps = (item.steps ?? []).filter(step => step.text.trim());
  return { done: steps.filter(step => step.done).length, count: steps.length, percent: item.done ? 100 : steps.length ? 100*steps.filter(step => step.done).length/steps.length : 0 };
}
function linesForStars(stars: Entry[]) {
  const chains = stars.map((_, i) => STAR_POSITIONS[i]);
  return chains.slice(1).map((point, i) => {
    const from = chains[i];
    const bendX = (from.x + point.x)/2 + (i % 2 ? -16 : 21);
    const bendY = (from.y + point.y)/2 - 13;
    return { path: `M ${from.x} ${from.y} Q ${bendX} ${bendY} ${point.x} ${point.y}`, id: `${stars[i].id}-${stars[i+1].id}`, lit: Boolean(stars[i].done && stars[i+1].done) };
  });
}
export function WishConstellation({ bond, names, rows, allCount, filter, busy, focusRecordId, glowingRecordId,
  onFilter, onNew, onAI, onOpen, onToggleDone }: WishConstellationProps) {
  const [view, setView] = useState<'sky'|'list'>('sky');
  const [page,setPage] = useState(0);
  const [focusedId,setFocusedId] = useState<string|undefined>(focusRecordId);
  const [drag,setDrag] = useState(0);
  const touch = useRef<{x:number;y:number}|null>(null);
  const ignoreClick = useRef(false);
  const maxPage = Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1);
  const currentPage = clamp(page,0,maxPage);
  const stars = rows.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  const focused = rows.find(item => item.id === focusedId);
  const finished = bond.entries.filter(item => item.kind === 'wish' && item.done).length;
  useEffect(() => {
    if(focusRecordId && rows.some(item => item.id === focusRecordId)) {
      setFocusedId(focusRecordId);
      const index = rows.findIndex(item => item.id === focusRecordId);
      setPage(Math.floor(index/PAGE_SIZE));
    }
  },[focusRecordId]);
  useEffect(() => {
    if(focusedId && !rows.some(item => item.id === focusedId)) setFocusedId(undefined);
  },[rows,focusedId]);
  const movePage = (delta:number) => {
    setFocusedId(undefined);
    setPage(current => clamp(current+delta,0,maxPage));
  };
  const onTouchStart = (event:React.TouchEvent) => {
    const t=event.touches[0]; if(t) touch.current={x:t.clientX,y:t.clientY};
    ignoreClick.current=false;
  };
  const onTouchMove = (event:React.TouchEvent) => {
    const t=event.touches[0]; const start=touch.current;
    if(!start || !t) return;
    const dx=t.clientX-start.x,dy=t.clientY-start.y;
    if(Math.abs(dx)>8 && Math.abs(dx)>Math.abs(dy)*1.2) setDrag(clamp(dx,-95,95));
  };
  const onTouchEnd = (event:React.TouchEvent) => {
    const t=event.changedTouches[0]; const start=touch.current;
    touch.current=null;setDrag(0);
    if(!start||!t) return;
    const dx=t.clientX-start.x,dy=t.clientY-start.y;
    if(Math.abs(dx)<55 || Math.abs(dx)<Math.abs(dy)*1.2 || view!=='sky') return;
    ignoreClick.current=true;
    if(maxPage>0) movePage(dx<0?1:-1);
    else setFocusedId(undefined);
  };
  const choose = (item:Entry) => {
    if(ignoreClick.current){ignoreClick.current=false;return;}
    setFocusedId(prev=>prev===item.id?undefined:item.id);
  };
  return <section className="wish-universe" aria-label="愿望清单 · 双人星图">
    <header className="wish-universe-heading">
      <span className="wish-universe-heading-overline">THE SPACE BETWEEN US</span>
      <div className="wish-universe-heading-main"><h2>愿望清单</h2><div className="wish-universe-tally">
        <strong>{String(finished).padStart(2,'0')}</strong><span> / {String(allCount).padStart(2,'0')}</span></div></div>
      <div className="wish-universe-heading-bottom"><span>{names.me} <i>×</i> {names.them}</span><span>已点亮 {finished} 颗</span></div>
    </header>

    <div className="wish-universe-bar">
      <label>星域 <select aria-label="按分类筛选愿望" value={filter} onChange={event=>{onFilter(event.target.value);setFocusedId(undefined);setPage(0);}}>
        <option value="all">全部愿望</option>
        {Object.entries(wishCategories).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select></label>
      <div className="wish-universe-view"><button type="button" aria-pressed={view==='sky'} onClick={()=>setView('sky')}>星图</button>
        <button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>目录</button></div>
    </div>

    {view==='sky' ? <div className="wish-universe-field" onTouchStart={onTouchStart}
      onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      onTouchCancel={()=>{touch.current=null;setDrag(0);}}>
      <div className="wish-universe-nebula" aria-hidden="true"/>
      <div className="wish-universe-ambient" aria-hidden="true">{ambient.map(([x,y,size],i)=><i key={i} style={{left:x+'%',top:y+'%',opacity:size}}/>)}</div>
      <div className="wish-universe-gravity" aria-hidden="true"><span/><span/><span/></div>
      {stars.length>0 ? <div className="wish-universe-plane" style={{transform:`translateX(${drag*.46}px)`}}>
        <svg className="wish-universe-connections" viewBox="0 0 380 500" preserveAspectRatio="none" aria-hidden="true">
          <circle cx="190" cy="247" r="126" className="wish-universe-orbit" />
          <ellipse cx="190" cy="249" rx="180" ry="105" transform="rotate(-29 190 249)" className="wish-universe-orbit faint"/>
          {linesForStars(stars).map(edge=><path key={edge.id} d={edge.path} className={edge.lit?'is-lit':''}/>)}
        </svg>
        {stars.map((item,i)=>{
          const p=STAR_POSITIONS[i], stats=stepCompletion(item);
          const selected=focusedId===item.id;
          return <button type="button" key={item.id} className={'wish-universe-star'+(item.done?' is-done':'')+(selected?' is-focused':'')+
            (glowingRecordId===item.id?' is-newly-lit':'')+(item.pinned?' is-pinned':'')}
            style={{left:p.x/380*100+'%',top:p.y/500*100+'%', '--wish-progress':stats.percent+'%','--wish-delay':(i*-.75)+'s'} as React.CSSProperties}
            disabled={busy} aria-pressed={selected} aria-label={item.title+'，'+(item.done?'已实现':'待实现')}
            onClick={()=>choose(item)}>
            <span className="wish-universe-star-field"><span className="wish-universe-star-corona"/><span className="wish-universe-star-core"/>
              <span className="wish-universe-star-cross"/><span className="wish-universe-star-progress"/></span>
            <span className="wish-universe-star-title">{item.title}</span>
          </button>;
        })}
      </div> : <div className="wish-universe-empty">
        <button type="button" className="wish-universe-first-star" disabled={busy} onClick={onNew} aria-label="点亮第一颗愿望星">
          <span className="wish-universe-first-orbit"/><span className="wish-universe-first-core">✧</span>
        </button>
        <div className="wish-universe-empty-hint">{filter==='all'?'轻触中央，许下第一个愿望':'这个星域还没有愿望'}</div>
        {filter!=='all' && <button type="button" className="wish-universe-all" onClick={()=>onFilter('all')}>查看全部愿望</button>}
      </div>}
      {focused && stars.some(item=>item.id===focused.id) && <div className={'wish-universe-focus'+(focused.done?' is-done':'')} key={focused.id}>
        <button type="button" className="wish-universe-close" aria-label="收起愿望" onClick={()=>setFocusedId(undefined)}>×</button>
        <span className="wish-universe-focus-caption">{focused.done?'STAR LIT · 已实现':'A WISH · 等待实现'}</span>
        <h3>{focused.title}</h3>
        <p>{focused.body?.trim() || (focused.wishTag ? wishTags[focused.wishTag] : wishCategories[focused.wishCategory ?? 'other'])}</p>
        <div className="wish-universe-focus-progress">
          <span>{stepCompletion(focused).count ? '小目标 '+stepCompletion(focused).done+' / '+stepCompletion(focused).count : focused.date}</span>
          <span>{focused.done?'光已点亮':'轨迹等待延伸'}</span>
        </div>
        <div className="wish-universe-focus-actions">
          <button type="button" disabled={busy} onClick={()=>onOpen(focused.id)}>查看愿望 ↗</button>
          <button type="button" disabled={busy} onClick={()=>onToggleDone(focused)}>{focused.done?'重新打开':'点亮愿望 ✧'}</button>
        </div>
      </div>}
      {stars.length>0 && <div className="wish-universe-paging">
        <button type="button" aria-label="上一片星域" disabled={busy||currentPage===0} onClick={()=>movePage(-1)}>‹</button>
        <span>{String(currentPage+1).padStart(2,'0')} / {String(maxPage+1).padStart(2,'0')}</span>
        <button type="button" aria-label="下一片星域" disabled={busy||currentPage===maxPage} onClick={()=>movePage(1)}>›</button>
      </div>}
    </div> : <div className="wish-universe-list" aria-label="愿望目录">
      {rows.length?rows.map((item,i)=>{
        const stats=stepCompletion(item);
        return <button key={item.id} type="button" onClick={()=>onOpen(item.id)} disabled={busy}>
          <span className={'wish-universe-list-dot'+(item.done?' is-done':'')}/>
          <span className="wish-universe-list-body"><strong>{item.title}</strong>
            <small>{wishCategories[item.wishCategory??'other']}{item.wishTag?' · '+wishTags[item.wishTag]:''}</small></span>
          <span className="wish-universe-list-progress">{item.done?'已实现':stats.count?stats.done+'/'+stats.count:'↗'}</span>
        </button>;
      }):<p>{filter==='all'?'第一颗星星尚未点亮':'这个分类还没有愿望'}</p>}
    </div>}

    <div className="wish-universe-actions">
      <button type="button" className="wish-universe-new" disabled={busy} onClick={onNew}><span aria-hidden="true">＋</span> 许一个心愿</button>
      <button type="button" className="wish-universe-partner" disabled={busy} onClick={onAI}>听听 {names.them} 的愿望 <span>↗</span></button>
    </div>
  </section>;
}
