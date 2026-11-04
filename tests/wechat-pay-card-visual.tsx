import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,GearSix,MagnifyingGlass} from '@phosphor-icons/react';
import PhoneWeChatPayCards from '../components/chat/PhoneWeChatPayCards';
import type {PhoneMessage} from '../utils/characterPhoneIdentity';

const messages:PhoneMessage[]=[
 {speaker:{role:'contact',contactId:'service:微信支付'},
  text:'微信支付通知：深圳市黑刺纹身器材商行 · 支出 ¥680.00；定制纯黑割线色料与一次性针嘴补货',
  createdAt:new Date('2026-11-01T08:27:00').getTime()},
 {speaker:{role:'contact',contactId:'service:微信支付'},
  text:'微信支付通知：美宜佳便利店 · 支出 ¥46.00；两包烟和一罐冰美式',
  createdAt:new Date('2026-11-01T08:29:00').getTime()},
 {speaker:{role:'contact',contactId:'service:微信支付'},
  text:'微信支付通知：索尼互动娱乐（PlayStation Store） · 支出 ¥198.00；购买新上架的悬疑解谜游戏数字版',
  createdAt:new Date('2026-11-02T22:21:00').getTime()}
];
createRoot(document.getElementById('root')!).render(
 <div className="flex h-[940px] flex-col bg-[#ededed]">
  <div className="flex h-[44px] shrink-0 items-center justify-between px-5 text-[14px] font-semibold text-[#191919]">
    <span>16:09</span><span className="text-xs">4G ▰▰▰ ▰</span>
  </div>
  <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#ddd] px-4">
    <ArrowLeft size={23}/><h1 className="text-[19px] font-medium">微信支付</h1>
    <div className="flex gap-4"><MagnifyingGlass size={21}/><GearSix size={22}/></div>
  </div>
  <main id="wechat-pay-scroll" className="min-h-0 flex-1 overflow-y-auto">
   <PhoneWeChatPayCards messages={messages}/>
  </main>
  <nav className="grid h-[56px] shrink-0 grid-cols-[48px_repeat(3,minmax(0,1fr))] items-center border-t border-[#ddd] bg-[#fafafa] text-center text-[14px]">
    <span className="flex justify-center border-r border-[#ddd]"><span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#444] text-[17px]">⌨</span></span>
    <span className="border-r border-[#ddd]">我的账单</span><span className="border-r border-[#ddd]">支付服务</span><span>优惠</span>
  </nav>
 </div>
);
setTimeout(()=>{
  const view=new URLSearchParams(location.search).get('view')||'top';
  const cards=[...document.querySelectorAll<HTMLElement>('[data-testid="wechat-pay-card"]')];
  const scroll=document.getElementById('wechat-pay-scroll')!;
  if(view==='second'&&cards[1])scroll.scrollTop=cards[1].offsetTop-160;
  const width=cards[0]?.getBoundingClientRect().width||0;
  const bounds=cards[0]?.getBoundingClientRect();
  const noOverflow=document.documentElement.scrollWidth<=Math.max(390,innerWidth);
  const hasAmount=!!document.querySelector('[data-testid="wechat-pay-card"] strong');
  const rootBounds=document.getElementById('root')!.getBoundingClientRect();
  const ready=cards.length===3&&Math.abs(width-(rootBounds.width-32))<=2&&!!bounds&&bounds.left>=rootBounds.left+14&&noOverflow&&hasAmount;
  document.body.dataset.ready=String(ready);
  document.getElementById('wechat-pay-test-status')!.textContent=JSON.stringify({ready,view,rootWidth:rootBounds.width,width,left:bounds?.left,amount:hasAmount});
},1800);
