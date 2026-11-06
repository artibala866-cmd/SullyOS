/* Test-only screenshot fixtures: this mounts the real anniversary BondRecords branch. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BondRecords } from '../apps/couplesSpace/records';
import { createBond, type Bond, type Entry } from '../utils/couplesSpace';
import '../apps/couplesSpace/couplesSpace.css';
import '../apps/couplesSpace/anniversaryAesthetic.css';

const state = new URLSearchParams(location.search).get('state') || 'empty';
const photo = (tone: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">'
  + '<rect width="300" height="400" fill="'+tone+'"/><circle cx="140" cy="134" r="62" fill="#d9d9dc"/>'
  + '<path d="M34 370 Q45 211 146 225 Q258 236 268 370Z" fill="#77777e"/>'
  + '<path d="M0 375 H300" stroke="#f8f8f8" stroke-width="16"/></svg>');
const entries: Entry[] = [
  {id:'qa-memory-1',kind:'anniversary',date:'2026-03-14',title:'一起度过的第一个春天',body:'那天在街角拍了我们的第一张合照。',side:'me',image:photo('#babac0')},
  {id:'qa-memory-2',kind:'anniversary',date:'2026-07-22',title:'第一次一起旅行',body:'记住车窗外的风景。',side:'them'},
  {id:'qa-memory-3',kind:'anniversary',date:'2026-10-20',title:'一起庆祝生日',body:'很平常，但我们在一起。',side:'me',image:photo('#c8c8ce')},
  {id:'qa-memory-4',kind:'anniversary',date:'2025-12-19',title:'一段长长长长的日期标题，测试小屏裁切',body:'长内容也要安全显示，不能推挤照片和箭头。',side:'them'}
];
const initial = () => ({
  ...createBond(['anniv-me','anniv-other']),start:'2025-11-05',
  entries: state==='empty' ? [] : state==='long' ? [...entries, ...entries.map((v,i)=>({...v,id:v.id+'-x',title:v.title+' / '+i}))] : entries,
});
function App() {
  const [bond,setBond] = useState<Bond>(initial);
  const [notice,setNotice] = useState('');
  useEffect(()=>{
    const t = window.setTimeout(()=>{
      if(state==='editor') document.querySelector<HTMLButtonElement>('.couple-anniversary-add')?.click();
      if(state==='detail') document.querySelector<HTMLButtonElement>('.couple-anniversary-story:not(.is-origin)')?.click();
    },600);
    return ()=>window.clearTimeout(t);
  },[]);
  useEffect(()=>{
    const t = window.setTimeout(()=>{
      const el=document.querySelector<HTMLOutputElement>('#anniv-qa-metrics');
      if(!el)return;
      el.dataset.ready='true';
      el.dataset.overflow=String(document.documentElement.scrollWidth>window.innerWidth+2);
      el.dataset.hero=String(!!document.querySelector('.couple-anniversary-hero'));
      el.dataset.ledger=String(!!document.querySelector('.couple-anniversary-story-list'));
      el.dataset.editor=String(!!document.querySelector('.couple-compose-anniversary'));
      el.dataset.detail=String(!!document.querySelector('.couple-entry-anniversary'));
      el.dataset.rows=String(document.querySelectorAll('.couple-anniversary-story').length);
    },1900);
    return ()=>window.clearTimeout(t);
  },[bond]);
  return <div className="couple-app couple-content-mode" style={{height:'100dvh',minHeight:0}}>
    <header className="couple-header"><button aria-label="返回">‹</button><h1>纪念日</h1><span/></header>
    <main className="couple-main"><BondRecords kind="anniversary" bond={bond} names={{me:'简妹',them:'周树生'}}
      avatarMe={state==='no-avatar'?undefined:photo('#c6c6ca')}
      avatarThem={state==='no-avatar'?undefined:photo('#e0e0e0')}
      change={async update=>{setBond(current=>update(current));}}
      generate={async()=> '2026-04-23｜第一次一起看日落\n那天很安静。'}
      busy={false} notify={setNotice}/>{notice&&<output role="status">{notice}</output>}
    </main>
    <output id="anniv-qa-metrics" aria-hidden="true" style={{position:'fixed',left:-9999,top:-9999}} data-ready="false"/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
