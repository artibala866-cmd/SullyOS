/* Real BondRecords component visual QA. Fixtures are test-only, never shipped as user records. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Bond, Entry } from '../utils/couplesSpace';
import { createBond } from '../utils/couplesSpace';
import { BondRecords } from '../apps/couplesSpace/records';
import '../apps/couplesSpace/couplesSpace.css';
import '../apps/couplesSpace/timelineCinema.css';

const state = new URLSearchParams(location.search).get('state') || 'populated';
const memorySvg = (label: string) => 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#45464c"/><stop offset=".6" stop-color="#aaabb0"/><stop offset="1" stop-color="#272832"/></linearGradient></defs><rect width="1000" height="700" fill="url(#g)"/><circle cx="780" cy="170" r="145" fill="#dadadc" opacity=".48"/><path d="M0 610 Q230 390 470 500 T1000 420 L1000 700 H0Z" fill="#36373d" opacity=".55"/><path d="M220 700 Q250 270 450 420 Q540 470 560 700" fill="#16171b" opacity=".72"/><path d="M405 700 Q460 290 610 350 Q730 420 750 700" fill="#25262b" opacity=".70"/><text x="74" y="90" fill="#f0f0f0" font-family="Georgia" font-size="21" letter-spacing="9">${label.replace(/[&<>]/g,'')}</text></svg>`);
const sample: Entry[] = [
  {id:'qa-1',kind:'timeline',title:'初次一起看海',body:'天色慢慢暗下来，我们沿着海岸走了很久。那天的风很轻。',date:'2026-11-02',time:'18:36',timelineTag:'约会',side:'me',images:[memorySvg('OUR MOMENT')]},
  {id:'qa-2',kind:'timeline',title:'你记得那个下午吗',body:'没有什么大事发生，却是一个想认真收藏的日子。',date:'2026-10-28',timelineTag:'日常',side:'them'},
  {id:'qa-3',kind:'timeline',title:'第一次牵手',body:'在路灯亮起之前，我们的手悄悄碰在了一起。',date:'2026-10-14',timelineTag:'里程碑',side:'me',images:[memorySvg('MEMORIES')]},
  {id:'qa-4',kind:'timeline',title:'属于我们的一个小小周末',body:'把平凡的一天也留在胶片里。',date:'2026-09-30',timelineTag:'日常',side:'them'},
];
function App() {
  const [bond,setBond] = useState<Bond>(()=>({ ...createBond(['qa-me','qa-them']), start:'2025-11-05',entries:state==='empty' ? [] : sample }));
  const [message,setMessage] = useState('');
  useEffect(()=>{
    if(state!=='editor'&&state!=='detail'&&state!=='handbook') return;
    const t = window.setTimeout(()=>{
      if(state==='editor') document.querySelector<HTMLButtonElement>('.couple-cinema-frame-add')?.click();
      if(state==='detail') document.querySelector<HTMLButtonElement>('.couple-cinema-picture')?.click();
      if(state==='handbook') [...document.querySelectorAll<HTMLButtonElement>('.couple-segments button')].find(b=>b.textContent==='手账')?.click();
    },850);
    return ()=>clearTimeout(t);
  },[]);
  useEffect(()=>{
    const timer = window.setTimeout(()=>{
      const out = document.getElementById('qa-metrics');
      if(out) {
        out.dataset.ready='true';
        out.dataset.state=state;
        out.dataset.overflow=String(document.documentElement.scrollWidth > window.innerWidth + 2);
        out.dataset.frames=String(document.querySelectorAll('.couple-cinema-frame').length);
      }
    },1700);
    return ()=>clearTimeout(timer);
  },[bond]);
  return <div className="couple-app couple-content-mode" style={{height:'100dvh',minHeight:0}}>
    <div className="couple-header"><button type="button" aria-label="返回">‹</button><h1>牵绊时光</h1><button aria-label="设置">⋯</button></div>
    <main className="couple-main"><BondRecords kind="timeline" bond={bond} names={{me:'简妹',them:'周树生'}}
      change={async update=>{setBond(current=>update(current));}}
      generate={async()=> '回忆是那些平常却值得记住的时刻。'}
      generateTimeline={async()=> '那天很特别，我们一起度过了很美好的时间。'}
      busy={false} notify={setMessage}/>
      {message && <output role="status">{message}</output>}</main>
    <output id="qa-metrics" aria-hidden="true" style={{position:'fixed',left:-9999,top:-9999}} data-ready="false"/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
