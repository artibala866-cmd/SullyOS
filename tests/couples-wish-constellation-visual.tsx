/* Screenshot fixture, not production content. Render the real BondRecords wish branch. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Bond, Entry } from '../utils/couplesSpace';
import { createBond } from '../utils/couplesSpace';
import { BondRecords } from '../apps/couplesSpace/records';
import '../apps/couplesSpace/couplesSpace.css';
import '../apps/couplesSpace/timelineCinema.css';
import '../apps/couplesSpace/wishConstellation.css';

const scene = new URLSearchParams(location.search).get('state') ?? 'populated';
const wishes:Entry[]=[
 {id:'wish-01',kind:'wish',date:'2026-11-02',title:'一起看海',body:'在一片安静的海边等日落，听一整晚的海浪。',side:'me',wishCategory:'places',wishTag:'soon',steps:[{text:'选一个周末',done:true},{text:'订好行程',done:false}]},
 {id:'wish-02',kind:'wish',date:'2026-10-31',title:'看第一场雪',body:'想和你一起看雪。',side:'them',wishCategory:'activities',wishTag:'thisYear',steps:[{text:'准备围巾',done:false}]},
 {id:'wish-03',kind:'wish',date:'2026-10-29',title:'第一次旅行',body:'去了很远的地方。',side:'me',done:true,wishCategory:'places',wishTag:'planning'},
 {id:'wish-04',kind:'wish',date:'2026-10-26',title:'做一顿晚餐',body:'一起研究新菜谱。',side:'me',wishCategory:'food',wishTag:'smallJoy',steps:[{text:'挑选食材',done:false}]},
 {id:'wish-05',kind:'wish',date:'2026-10-20',title:'拍下合照',body:'想留下好看的双人照片。',side:'them',wishCategory:'memorable',wishTag:'soon'},
 {id:'wish-06',kind:'wish',date:'2026-10-15',title:'一起看日出',body:'凌晨早起。',side:'me',wishCategory:'activities',done:true},
 {id:'wish-07',kind:'wish',date:'2026-10-10',title:'去山顶露营',body:'想看星星。',side:'them',wishCategory:'places'},
 {id:'wish-08',kind:'wish',date:'2026-10-08',title:'交换手写信',body:'',side:'me',wishCategory:'memorable',pinned:true},
 {id:'wish-09',kind:'wish',date:'2026-10-04',title:'一起养一只猫',body:'',side:'them',wishCategory:'other'},
 {id:'wish-10',kind:'wish',date:'2026-10-02',title:'看一场电影',body:'',side:'me',wishCategory:'activities'},
 {id:'wish-11',kind:'wish',date:'2026-09-30',title:'去散步',body:'',side:'me',wishCategory:'activities'},
];
function App(){
  const [bond,setBond]=useState<Bond>(()=>({...createBond(['wish-test-me','wish-test-other']),start:'2025-11-05',
    entries:(scene==='empty'||scene==='create-first')?[]:scene==='many'?wishes:wishes.slice(0,7)}));
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const action=window.setTimeout(()=>{
      const star=document.querySelector<HTMLButtonElement>('.wish-universe-star');
      if(scene==='focus' || scene==='detail' || scene==='complete') star?.click();
      if(scene==='list') document.querySelector<HTMLButtonElement>('.wish-universe-view button:last-child')?.click();
      if(scene==='editor') document.querySelector<HTMLButtonElement>('.wish-universe-new')?.click();
      if(scene==='create-first') {
        document.querySelector<HTMLButtonElement>('.wish-universe-first-star')?.click();
        window.setTimeout(()=>{
          const input=document.querySelector<HTMLInputElement>('.couple-compose-wish .couple-edit-title input');
          const form=document.querySelector<HTMLFormElement>('.couple-compose-wish');
          const nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
          if(input && form){nativeSetter?.call(input,'第一颗属于我们的星星');input.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();}
        },400);
      }
      if(scene==='many') document.querySelector<HTMLButtonElement>('.wish-universe-paging button:last-child')?.click();
      if(scene==='role') document.querySelector<HTMLButtonElement>('.wish-universe-partner')?.click();
      if(scene==='filtered') {
        const nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value')?.set;
        const select=document.querySelector<HTMLSelectElement>('.wish-universe-bar select');
        if(select){nativeSetter?.call(select,'food');select.dispatchEvent(new Event('change',{bubbles:true}));}
      }
      if(scene==='detail') window.setTimeout(()=>document.querySelector<HTMLButtonElement>('.wish-universe-focus-actions button:first-child')?.click(),350);
      if(scene==='complete') window.setTimeout(()=>document.querySelector<HTMLButtonElement>('.wish-universe-focus-actions button:last-child')?.click(),350);
    },700);
    return ()=>clearTimeout(action);
  },[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const output=document.querySelector<HTMLOutputElement>('#qa-wish-metrics');
      if(!output) return;
      output.dataset.ready='true';output.dataset.state=scene;
      output.dataset.overflow=String(document.documentElement.scrollWidth>window.innerWidth+2);
      output.dataset.stars=String(document.querySelectorAll('.wish-universe-star').length);
      output.dataset.focus=String(Boolean(document.querySelector('.wish-universe-focus')));
      output.dataset.editor=String(Boolean(document.querySelector('.couple-compose-wish')));
      output.dataset.detail=String(Boolean(document.querySelector('.couple-detail-wish')));
      output.dataset.completed=String(Boolean(document.querySelector('.wish-universe-star.is-done.is-newly-lit')));
      output.dataset.page=document.querySelector('.wish-universe-paging span')?.textContent?.trim()??'';
      output.dataset.list=String(Boolean(document.querySelector('.wish-universe-list')));
    },2300);
    return ()=>clearTimeout(timer);
  },[bond]);
  return <div className="couple-app couple-content-mode" style={{height:'100dvh',minHeight:0}}>
    <header className="couple-header"><button aria-label="返回">‹</button><h1>情侣空间</h1><span/></header>
    <main className="couple-main"><BondRecords kind="wish" bond={bond} names={{me:'简妹',them:'周树生'}}
      change={async(update)=>{setBond(current=>update(current));}}
      generate={async()=> '一起去看北方的雪\n想在雪里走很久。'}
      busy={false} notify={setMessage}/>
      {message&&<output role="status">{message}</output>}</main>
    <output id="qa-wish-metrics" aria-hidden="true" style={{position:'fixed',left:-9999,top:-9999}} data-ready="false"/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
