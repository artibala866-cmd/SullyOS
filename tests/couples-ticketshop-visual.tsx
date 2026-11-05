
/* Screenshot QA fixture for the REAL BondShop React component; no fixture data ships to production. */
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createBond,shopCards,type Bond} from '../utils/couplesSpace';
import {BondShop} from '../apps/couplesSpace/shop';
import '../apps/couplesSpace/couplesSpace.css';
import '../apps/couplesSpace/bondTicketShop.css';

const scene=new URLSearchParams(location.search).get('state')||'shop';
function App(){
  const [bond,setBond]=useState<Bond>(()=>({...createBond(['qa-me','qa-them']),
    points:{me:580,shared:420,them:265},
    bags:{me:(scene==='bag-empty'?{}:{hug:2,photo:1,sweet:1,peace:1}),
      them:{nickname:1,listen:1}},
    entries:[],
  }));
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const root=document.querySelector('.bond-ticket-room');
      const click=(selector:string)=>root?.querySelector<HTMLButtonElement>(selector)?.click();
      if(scene==='next') click('.bond-ticket-navigator button:last-child');
      if(scene==='empty') click('.bond-ticket-shelves button:last-child');
      if(scene==='bag'||scene==='bag-empty'||scene==='play') click('.bond-ticket-tabs button:nth-child(2)');
      if(scene==='tasks') click('.bond-ticket-tabs button:nth-child(3)');
      if(scene==='grand') click('.bond-ticket-tabs button:nth-child(4)');
      if(scene==='editor') click('.bond-ticket-utilities button:first-child');
      if(scene==='exchange') click('.bond-ticket-buy');
      if(scene==='play') {
        window.prompt=()=>'';window.setTimeout(()=>click('.bond-ticket-wallet-pass-foot button'),350);
      }
    },620);
    return ()=>window.clearTimeout(timer);
  },[]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      const output=document.querySelector<HTMLOutputElement>('#qa-ticket-metrics');
      if(!output)return;
      output.dataset.ready='true';
      output.dataset.state=scene;
      output.dataset.overflow=String(document.documentElement.scrollWidth>innerWidth+2);
      output.dataset.view=document.querySelector('.bond-ticket-room')?.getAttribute('data-shop-view')||'';
      output.dataset.tickets=String(document.querySelectorAll('.bond-ticket-pass').length);
      output.dataset.wallet=String(!!document.querySelector('.bond-ticket-wallet-pass'));
      output.dataset.editor=String(!!document.querySelector('.couple-shop-editor'));
      output.dataset.points=String(bond.points.me);
    },2200);
    return ()=>window.clearTimeout(timer);
  },[bond]);
  return <div className="couple-app couple-content-mode" style={{height:'100dvh',minHeight:0}}>
    <header className="couple-header"><button aria-label="返回">‹</button><h1>情侣空间</h1><span/></header>
    <main className="couple-main"><BondShop bond={bond} partner="周树生"
      change={async update=>{setBond(current=>update(current));}}
      generate={async()=>'{ "accept":true, "reply":"当然愿意。" }'}
      share={async()=>{}}
      notify={setMessage} busy={false} />
      {message&&<output role="status">{message}</output>}
    </main>
    <output id="qa-ticket-metrics" aria-hidden="true" style={{position:'fixed',left:-9999,top:-9999}} data-ready="false" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
