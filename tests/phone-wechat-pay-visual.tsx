import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft, GearSix, House, MagnifyingGlass} from '@phosphor-icons/react';
import PhoneWeChatPayCards from '../components/chat/PhoneWeChatPayCards';
import type {PhoneMessage} from '../utils/characterPhoneIdentity';
const messages:PhoneMessage[]=[
  {speaker:{role:'contact',contactId:'service:微信支付'},createdAt:Date.UTC(2026,10,1,0,27),
    text:'微信支付通知：深圳市黑刺纹身器材商行 · 支出 ¥680.00；定制纯黑割线色料与一次性针嘴补货'},
  {speaker:{role:'contact',contactId:'service:微信支付'},createdAt:Date.UTC(2026,10,1,0,28),
    text:'微信支付通知：美宜佳便利店 · 支出 ¥46.00；两包烟和一罐冰美式'},
  {speaker:{role:'contact',contactId:'service:微信支付'},createdAt:Date.UTC(2026,10,2,14,21),
    text:'微信支付通知：索尼互动娱乐（PlayStation Store） · 支出 ¥198.00；购买新上架的悬疑解谜游戏数字版'}
];
createRoot(document.getElementById('root')!).render(
  <div style={{width:'390px',maxWidth:'100vw',height:'950px',display:'flex',flexDirection:'column',overflow:'hidden',background:'#ededed'}}>
    <div style={{height:42,flexShrink:0,background:'#ededed',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 17px',fontSize:13}}>16:08<span>4G ▮▮▮　◩ 50%</span></div>
    <header style={{height:76,flexShrink:0,background:'#ededed',borderBottom:'1px solid #ddd',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 17px'}}>
      <ArrowLeft size={23}/>
      <strong style={{fontSize:20,fontWeight:500}}>微信支付</strong>
      <span style={{display:'flex',gap:16}}><MagnifyingGlass size={22}/><GearSix size={23}/></span>
    </header>
    <main style={{minHeight:0,flex:1,overflowY:'auto'}}>
      <PhoneWeChatPayCards messages={messages}/>
    </main>
    <nav style={{height:60,flexShrink:0,background:'#fafafa',borderTop:'1px solid #ddd',display:'grid',gridTemplateColumns:'repeat(3,1fr)',alignItems:'center',textAlign:'center',fontSize:16}}>
      <span style={{borderRight:'1px solid #ddd'}}>我的账单</span>
      <span style={{borderRight:'1px solid #ddd'}}>支付服务</span>
      <span>优惠</span>
    </nav>
    <footer style={{height:46,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:'#fafafa',borderTop:'1px solid #ddd'}}><House size={24}/></footer>
  </div>
);
setTimeout(()=>{
  const cards=[...document.querySelectorAll<HTMLElement>('[data-testid="wechat-pay-card"]')];
  const widths=cards.map(c=>Math.round(c.getBoundingClientRect().width));
  const hasAmount=document.body.textContent?.includes('¥680.00');
  const noInput=!document.querySelector('input')&&!document.querySelector('button');
  const viewport=Math.round(document.getElementById('root')!.getBoundingClientRect().width);
  const ready=cards.length===3&&widths.every(w=>Math.abs(w-(viewport-32))<=2)&&hasAmount&&noInput;
  document.getElementById('pay-visual-status')!.textContent=JSON.stringify({ready,viewport,widths,hasAmount,noInput});
  document.body.dataset.ready=String(ready);
},1200);
