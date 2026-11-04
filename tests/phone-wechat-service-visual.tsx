import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,MagnifyingGlass,User} from '@phosphor-icons/react';
import PhoneWeChatServiceFeed from '../components/chat/PhoneWeChatServiceFeed';
import type {PhoneMessage} from '../utils/characterPhoneIdentity';

const view=new URLSearchParams(location.search).get('view')==='official'?'official':'service';
const source=view==='official'?'绘画资讯日报':'Krenz绘画教室';
const texts=view==='official'?[
  '三门正课更新！本周绘画练习重点与素描经验总结',
  '日本网友讨论创作教程与绘画课的实际价值，买家说法各不相同',
  '手绘材料记录：这几种画笔和纸张的比较',
  '画室日常：色彩与线稿练习心得',
]:[
  '三门正课作业1V1改！改图班0期内测来了！',
  '这一期毛厂的模特写真……我给到分!!!!!',
  '人物结构练习 · 清末出宫太监，皮笑肉不笑',
  '课程更新：从基础动态到人体结构练习笔记',
  '学员交稿啦，点评与作业反馈'
];
const messages:PhoneMessage[]=texts.map((text,i)=>({
  speaker:{role:'contact' as const,contactId:'service:'+source},
  text,createdAt:new Date('2026-11-04T16:20:00').getTime()-(texts.length-1-i)*3600000
}));
createRoot(document.getElementById('root')!).render(
 <div className="flex h-[950px] flex-col bg-[#ededed]">
  <div className="flex h-[45px] shrink-0 items-center justify-between px-5 text-[15px] text-[#171717]"><b>16:20</b><span className="text-xs">4G ▰▰▰ ▰</span></div>
  <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#e6e6e6] px-4">
    <ArrowLeft size={24}/><h1 className="text-[20px] font-medium">{view==='service'?'服务号':'公众号'}</h1><div className="flex gap-4"><MagnifyingGlass size={23}/><User size={24}/></div>
  </div>
  <main className="min-h-0 flex-1 overflow-y-auto"><PhoneWeChatServiceFeed messages={messages} kind={view} name={source}/></main>
 </div>
);
setTimeout(()=>{
 const rootBounds=document.getElementById('root')!.getBoundingClientRect();
 const feed=document.querySelector('[data-testid="phone-'+view+'-feed"]')?.getBoundingClientRect();
 const placeholders=[...document.querySelectorAll('[aria-label="图片占位"]')];
 const noHorizontalOverflow=!!feed && feed.width<=rootBounds.width && document.documentElement.scrollWidth<=Math.max(rootBounds.width,innerWidth);
 const ready=!!feed&&feed.width>=360&&placeholders.length>=3&&noHorizontalOverflow &&
  !!document.body.textContent?.includes(view==='service'?'贴图':'看一看');
 document.body.dataset.ready=String(ready);
 document.getElementById('wechat-feed-visual-status')!.textContent=JSON.stringify({
   ready,view,width:feed?.width,left:feed?.left,placeholders:placeholders.length,noHorizontalOverflow
 });
},1600);
