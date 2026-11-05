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
/* Only saved wishes become stars. Five widely spaced wishes per view keep titles legible on phones. */
const STAR_POSITIONS = [
  {x:88,y:112},{x:277,y:141},{x:160,y:255},{x:289,y:376},{x:86,y:413},
];
const PAGE_SIZE = STAR_POSITIONS.length;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function stepCompletion(item: Entry) {
  const steps = (item.steps ?? []).filter(step => step.text.trim());
  return { done: steps.filter(step => step.done).length, count: steps.length, percent: item.done ? 100 : steps.length ? 100*steps.filter(step => step.done).length/steps.length : 0 };
}
function linesForStars(stars: Entry[]) {
  return stars.slice(1).map((item,i) => {
    const from=STAR_POSITIONS[i], to=STAR_POSITIONS[i+1];
    const middleX=(from.x+to.x)/2;
    const middleY=(from.y+to.y)/2+(i%2 ? -8 : 8);
    return {id:stars[i].id+'-'+item.id,lit:!!(stars[i].done&&item.done),
      path:`M ${from.x} ${from.y} Q ${middleX} ${middleY} ${to.x} ${to.y}`};
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
  return <section className="wish-universe" aria-label="愿望清单 · 双人心愿图">
    <header className="wish-universe-heading">
      <div className="wish-universe-heading-main">
        <div className="wish-universe-identity"><h2>愿望清单</h2><div className="wish-universe-heading-bottom"><span>{names.me} <i>×</i> {names.them}</span></div></div>
        <div className="wish-universe-tally" aria-label={`已实现 ${finished} 个，共 ${allCount} 个愿望`}>
          <strong>{String(finished).padStart(2,'0')}</strong><span> / {String(allCount).padStart(2,'0')}</span>
        </div>
      </div>
    </header>

    <div className="wish-universe-bar">
      <label>分类 <select aria-label="按分类筛选愿望" value={filter} onChange={event=>{onFilter(event.target.value);setFocusedId(undefined);setPage(0);}}>
        <option value="all">全部愿望</option>
        {Object.entries(wishCategories).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select></label>
      <div className="wish-universe-view"><button type="button" aria-pressed={view==='sky'} onClick={()=>setView('sky')}>心愿图</button>
        <button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>目录</button></div>
    </div>

    {view==='sky' ? <div className={'wish-universe-field'+(stars.length===0?' is-empty':'')} onTouchStart={onTouchStart}
      onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      onTouchCancel={()=>{touch.current=null;setDrag(0);}}>
      {stars.length>0 ? <div className={'wish-universe-plane'+(focused && stars.some(item=>item.id===focused.id)?' has-focus':'')} style={{transform:`translateX(${drag*.46}px)`}}>
        <svg className="wish-universe-connections" viewBox="0 0 380 500" preserveAspectRatio="none" aria-hidden="true">
          
          {linesForStars(stars).map(edge=><path key={edge.id} d={edge.path} className={edge.lit?'is-lit':''}/>)}
        </svg>
        {stars.map((item,i)=>{
          const p=STAR_POSITIONS[i], stats=stepCompletion(item);
          const selected=focusedId===item.id;
          return <button type="button" key={item.id} className={'wish-universe-star'+(item.done?' is-done':'')+(selected?' is-focused':'')+
            (glowingRecordId===item.id?' is-newly-lit':'')+(item.pinned?' is-pinned':'')}
            style={{left:p.x/380*100+'%',top:p.y/500*100+'%', '--wish-progress':stats.percent+'%','--wish-delay':(i*-.75)+'s',
              '--wish-focus-x':((190-p.x)*.60)+'px','--wish-focus-y':((185-p.y)*.55)+'px'} as React.CSSProperties}
            disabled={busy} aria-pressed={selected} aria-label={item.title+'，'+(item.done?'已实现':'待实现')}
            onClick={()=>choose(item)}>
            <span className="wish-universe-star-field">
              <span className="wish-universe-star-core" aria-hidden="true" />
              <span className="wish-universe-star-ring" aria-hidden="true" />
              {stats.percent>0 && <span className="wish-universe-star-progress" aria-hidden="true"/>}
            </span>
            <span className="wish-universe-star-title">{item.title}</span>
          </button>;
        })}
      </div> : <div className="wish-universe-empty">
        <svg className="wish-universe-eclipse" viewBox="0 0 390 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <radialGradient id="wish-eclipse-shadow"><stop offset="0" stopColor="#17191e" stopOpacity=".68"/><stop offset=".75" stopColor="#111318" stopOpacity=".65"/><stop offset="1" stopColor="#08090d" stopOpacity=".2"/></radialGradient>
            <linearGradient id="wish-eclipse-rim" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#f5f5f5" stopOpacity="0"/><stop offset=".36" stopColor="#f6f6f6" stopOpacity=".08"/><stop offset=".64" stopColor="#ededed" stopOpacity=".38"/><stop offset=".83" stopColor="#fff" stopOpacity=".58"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient>
            <linearGradient id="wish-eclipse-trail" x1="0" y1=".5" x2="1" y2=".5"><stop offset="0" stopColor="#fff" stopOpacity="0"/><stop offset=".5" stopColor="#fff" stopOpacity=".14"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient>
          </defs>
          <ellipse cx="217" cy="275" rx="172" ry="210" fill="url(#wish-eclipse-shadow)"/>
          <path d="M83 425 C35 348 66 160 174 89 C276 28 397 143 369 286" fill="none" stroke="url(#wish-eclipse-rim)" strokeWidth="1.05"/>
          <path d="M-15 392 C106 457 226 430 361 304 C410 264 452 239 495 250" fill="none" stroke="url(#wish-eclipse-trail)" strokeWidth=".85"/>
        </svg>
        <button type="button" className="wish-universe-first-star" disabled={busy} onClick={onNew} aria-label="许下第一个愿望">
          <span className="wish-universe-first-core" aria-hidden="true"/>
        </button>
        <div className="wish-universe-empty-hint">{filter==='all'?'点亮第一个愿望':'这个分类还没有愿望'}</div>
        {filter!=='all' && <button type="button" className="wish-universe-all" onClick={()=>onFilter('all')}>查看全部愿望</button>}
      </div>}
      {focused && stars.some(item=>item.id===focused.id) && <div className={'wish-universe-focus'+(focused.done?' is-done':'')} key={focused.id}>
        <button type="button" className="wish-universe-close" aria-label="收起愿望" onClick={()=>setFocusedId(undefined)}>×</button>
        <span className="wish-universe-focus-caption">{focused.done?'已实现':'等待实现'}</span>
        <h3>{focused.title}</h3>
        <p>{focused.body?.trim() || (focused.wishTag ? wishTags[focused.wishTag] : wishCategories[focused.wishCategory ?? 'other'])}</p>
        <div className="wish-universe-focus-progress">
          <span>{stepCompletion(focused).count ? '小目标 '+stepCompletion(focused).done+' / '+stepCompletion(focused).count : focused.date}</span>
          <span>{focused.done?'心愿已实现':'心愿正在靠近'}</span>
        </div>
        <div className="wish-universe-focus-actions">
          <button type="button" disabled={busy} onClick={()=>onOpen(focused.id)}>查看愿望 ↗</button>
          <button type="button" disabled={busy} onClick={()=>onToggleDone(focused)}>{focused.done?'重新打开':'实现愿望'}</button>
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
          <span className={'wish-universe-list-dot'+(item.done?' is-done':'')} aria-hidden="true"/>
          <span className="wish-universe-list-body"><strong>{item.title}</strong>
            <small>{wishCategories[item.wishCategory??'other']}{item.wishTag?' · '+wishTags[item.wishTag]:''}</small></span>
          <span className="wish-universe-list-progress">{item.done?'已实现':stats.count?stats.done+'/'+stats.count:'↗'}</span>
        </button>;
      }):<p>{filter==='all'?'还没有写下愿望':'这个分类还没有愿望'}</p>}
    </div>}

    <div className="wish-universe-actions">
      {(allCount>0 || filter!=='all' || view==='list') && <button type="button" className="wish-universe-new" disabled={busy} onClick={onNew}><span aria-hidden="true">＋</span> 许一个心愿</button>}
      <button type="button" className="wish-universe-partner" disabled={busy} onClick={onAI}>听听 {names.them} 的愿望 <span>↗</span></button>
    </div>
  </section>;
}
