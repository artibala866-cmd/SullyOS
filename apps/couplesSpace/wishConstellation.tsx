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
  {x:72,y:121},{x:168,y:75},{x:298,y:146},{x:323,y:285},
  {x:208,y:343},{x:76,y:329},{x:133,y:461},{x:298,y:439},
];
/* Unlabelled ambient hearts express the space, never pretend to be saved wishes. */
const quietHearts = [
  {x:31,y:75,s:.45},{x:106,y:43,s:.34},{x:268,y:43,s:.48},{x:348,y:82,s:.32},
  {x:363,y:206,s:.43},{x:237,y:184,s:.41},{x:128,y:220,s:.35},{x:43,y:248,s:.54},
  {x:19,y:388,s:.39},{x:194,y:262,s:.58},{x:290,y:362,s:.32},{x:360,y:405,s:.48},
  {x:234,y:470,s:.40},{x:64,y:470,s:.44},{x:202,y:120,s:.31},{x:154,y:385,s:.32},
];
const heartShape = 'M 0 -7 C -12 -22 -31 -8 -24 9 C -18 22 -5 26 0 32 C 5 26 18 22 24 9 C 31 -8 12 -22 0 -7 Z';
const PAGE_SIZE = STAR_POSITIONS.length;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function stepCompletion(item: Entry) {
  const steps = (item.steps ?? []).filter(step => step.text.trim());
  return { done: steps.filter(step => step.done).length, count: steps.length, percent: item.done ? 100 : steps.length ? 100*steps.filter(step => step.done).length/steps.length : 0 };
}
function linesForStars(stars: Entry[]) {
  return stars.slice(1).map((item,i) => {
    const from=STAR_POSITIONS[i], to=STAR_POSITIONS[i+1];
    const middleX=(from.x+to.x)/2+(i%2 ? -20 : 16);
    const middleY=(from.y+to.y)/2-18;
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
      
      <div className="wish-universe-heading-main"><h2>愿望清单</h2><div className="wish-universe-tally">
        <strong>{String(finished).padStart(2,'0')}</strong><span> / {String(allCount).padStart(2,'0')}</span></div></div>
      <div className="wish-universe-heading-bottom"><span>{names.me} <i>×</i> {names.them}</span><span>已实现 {finished} / {allCount}</span></div>
    </header>

    <div className="wish-universe-bar">
      <label>分类 <select aria-label="按分类筛选愿望" value={filter} onChange={event=>{onFilter(event.target.value);setFocusedId(undefined);setPage(0);}}>
        <option value="all">全部愿望</option>
        {Object.entries(wishCategories).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select></label>
      <div className="wish-universe-view"><button type="button" aria-pressed={view==='sky'} onClick={()=>setView('sky')}>心愿图</button>
        <button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>目录</button></div>
    </div>

    {view==='sky' ? <div className="wish-universe-field" onTouchStart={onTouchStart}
      onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      onTouchCancel={()=>{touch.current=null;setDrag(0);}}>
      <svg className="wish-universe-heartspace" viewBox="0 0 380 520" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="wish-thread" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f5f5f5" stopOpacity=".11"/>
          <stop offset="43%" stopColor="#fafafa" stopOpacity=".60"/>
          <stop offset="100%" stopColor="#f5f5f5" stopOpacity=".19"/>
        </linearGradient></defs>
        <g className="wish-universe-threads">
          <path d="M31 75 Q 85 3 106 43 T202 120 T298 146 T363 206 T290 362 T360 405"/>
          <path d="M43 248 Q 58 170 128 220 T194 262 T290 362 T234 470"/>
          <path d="M19 388 Q 68 274 154 385 T234 470 T360 405"/>
          <path d="M64 470 Q 35 375 76 329 T194 262 T237 184 T268 43"/>
          
        </g>
        <g className="wish-universe-tiny-hearts">
          {quietHearts.map((p,i)=><g key={i} transform={`translate(${p.x} ${p.y}) scale(${p.s})`}
            style={{'--heart-delay':(i*-.39)+'s'} as React.CSSProperties}>
            <path d={heartShape}/>
          </g>)}
        </g>
      </svg>
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
              <svg className="wish-universe-heart-icon" viewBox="-31 -25 62 61" role="presentation">
                <path className="wish-universe-heart-outline" d={heartShape}/>
                <path className="wish-universe-heart-fill" d={heartShape}/>
                <path className="wish-universe-heart-progress" d={heartShape} pathLength={100}
                  style={{strokeDasharray:100,strokeDashoffset:100-stats.percent}}/>
              </svg>
            </span>
            <span className="wish-universe-star-title">{item.title}</span>
          </button>;
        })}
      </div> : <div className="wish-universe-empty">
        <button type="button" className="wish-universe-first-star wish-universe-first-heart" disabled={busy} onClick={onNew} aria-label="许下第一个愿望">
          <svg viewBox="-31 -25 62 61" aria-hidden="true"><path d={heartShape}/></svg>
        </button>
        <div className="wish-universe-empty-hint">{filter==='all'?'轻触那颗心，留下第一个愿望':'这个星域还没有愿望'}</div>
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
          <span className={'wish-universe-list-dot'+(item.done?' is-done':'')}/>
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
