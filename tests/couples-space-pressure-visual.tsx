/* Standalone heavy-load browser fixture using the real couples record and shop components. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BondRecords } from '../apps/couplesSpace/records';
import { BondShop } from '../apps/couplesSpace/shop';
import { createBond, type Bond, type Entry, type EntryKind } from '../utils/couplesSpace';
import '../apps/couplesSpace/couplesSpace.css';
import '../apps/couplesSpace/timelineCinema.css';
import '../apps/couplesSpace/wishConstellation.css';
import '../apps/couplesSpace/bondTicketShop.css';

const categories: EntryKind[] = ['timeline','wish','mail','capsule','gift','diary','anniversary','hollow'];
const count = Math.max(100, Math.min(4500, Number(new URLSearchParams(location.search).get('count')) || 3200));
const entries: Entry[] = Array.from({length:count},(_,i)=>{
  const kind=categories[i%categories.length];
  return {
    id:'browser-pressure-'+i,kind,date:'2026-10-'+String(i%28+1).padStart(2,'0'),
    title:'真实组件压力回忆第 '+i+' 条',body:'角色一起旅行、写信、照料花盆。'.repeat(25),
    side:i%2?'me':'them',...(kind==='capsule'?{unlockDate:'2028-10-10'}:{}),
    ...(kind==='wish'?{wishCategory:'places' as const}:{}),
  };
});
let visits=0;
const browserErrors:string[]=[];
window.addEventListener('error',event=>browserErrors.push(String(event.message)));
window.addEventListener('unhandledrejection',event=>browserErrors.push(String(event.reason)));
function App(){
  const [bond,setBond]=useState<Bond>(()=>({...createBond(['browser-stress']),status:'open',entries,
    points:{me:2500,them:800,shared:3000}}));
  const [page,setPage]=useState<EntryKind|'shop'>('timeline');
  const [finished,setFinished]=useState(false);
  useEffect(()=>{
    let remaining=35;
    let alive=true;
    const next=()=>{
      if(!alive)return;
      if(remaining--<=0){setFinished(true);return;}
      const target=categories[visits%categories.length];
      const button=document.querySelector<HTMLButtonElement>('[data-stress-tab="'+target+'"]');
      button?.click();
      visits++;
      window.setTimeout(next,105);
    };
    window.setTimeout(next,700);
    return()=>{alive=false;};
  },[]);
  useEffect(()=>{
    if(!finished)return;
    const settle=window.setTimeout(()=>{
      const output=document.querySelector<HTMLOutputElement>('#couple-pressure-report');
      if(!output)return;
      output.dataset.ready='true';
      output.dataset.entries=String(bond.entries.length);
      output.dataset.visits=String(visits);
      output.dataset.final=page;
      output.dataset.errors=String(browserErrors.length);
      output.dataset.overflow=String(document.documentElement.scrollWidth>innerWidth+2);
      output.dataset.width=String(innerWidth);
      output.dataset.cards=String(document.querySelectorAll('.couple-hollow-note-item').length);
      output.textContent=JSON.stringify({entries:bond.entries.length,visits,page,errors:browserErrors.slice(0,5),
        overflow:document.documentElement.scrollWidth>innerWidth+2});
    },700);
    return()=>clearTimeout(settle);
  },[finished,bond,page]);
  const change=async(update:(bond:Bond)=>Bond)=>{setBond(old=>update(old));};
  return <div className="couple-app couple-content-mode" style={{height:'100dvh',minHeight:0}}>
    <header className="couple-header"><span>‹</span><h1>情侣空间</h1><span/></header>
    <main className="couple-main">
      <nav style={{display:'flex',flexWrap:'wrap',gap:2}}>
        {categories.map(kind=><button key={kind} data-stress-tab={kind} onClick={()=>setPage(kind)}>{kind}</button>)}
        <button data-stress-tab="shop" onClick={()=>setPage('shop')}>shop</button>
      </nav>
      {page==='shop'
        ? <BondShop bond={bond} partner="压力测试角色" change={change} generate={async()=>'{ "accept":false, "reply":"no" }'}
            share={async()=>{}} busy={false}/>
        : <BondRecords key={page} kind={page} bond={bond} names={{me:'本人',them:'压力测试角色'}}
            change={change} generate={async()=>''} busy={false}/>}
      <output id="couple-pressure-report" data-ready="false" style={{position:'fixed',left:-9999,top:-9999}}/>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
