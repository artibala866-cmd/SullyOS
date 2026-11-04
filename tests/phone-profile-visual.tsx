import React from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft} from '@phosphor-icons/react';
import CharacterPhoneProfilePanel from '../components/chat/CharacterPhoneProfilePanel';

const view=new URLSearchParams(location.search).get('view')||'main';
createRoot(document.getElementById('root')!).render(
 <div className="flex h-[900px] flex-col bg-[#ededed]">
  <div className="flex h-[45px] shrink-0 items-center justify-between px-5 text-[14px] font-medium">17:01 <span className="text-xs">4G ▰▰▰ ▰</span></div>
  <div className="relative flex h-[65px] shrink-0 items-center justify-center border-b border-[#ddd]">
    <ArrowLeft size={23} className="absolute left-5"/><h2 className="text-[20px] font-medium">个人资料</h2>
  </div>
  <main className="min-h-0 flex-1 overflow-y-auto">
    <CharacterPhoneProfilePanel name="爸爸" avatar="" onOpenAvatarLibrary={()=>{}}
      manualGlimpseEnabled={true} onToggleManualGlimpse={()=>{}} glimpseNotice=""
      glimpseCount={8} lifeHistory={<ol className="space-y-3">{['今天下午去画室整理画稿','给朋友回了工作消息','晚上准备处理作品'].map((x,i)=><li key={x} className="border-l-2 border-[#ddd] pl-3 text-[13px] leading-6"><span className="text-[#999]">11月{4-i}日 · 已保存记录</span><p>{x}</p></li>)}</ol>}
      pokeSuffix="" onPoke={()=>{}} onAdjustProfile={()=>{}} selfAutoBusy={false}
    />
  </main>
  <div className="flex h-[49px] shrink-0 items-center justify-center border-t border-[#ddd] bg-[#fafafa] text-[#444]">⌂</div>
 </div>
);
setTimeout(()=>{
 if(view==='expanded')document.querySelector<HTMLDetailsElement>('details')?.setAttribute('open','');
 const p=document.querySelector<HTMLElement>('[data-testid="character-phone-profile-panel"]');
 const width=p?.getBoundingClientRect().width||0;
 const noOverflow=document.documentElement.scrollWidth<=Math.max(390,innerWidth);
 const hasControls=!!p?.textContent?.includes('头像库')&&!!p?.textContent?.includes('戳一戳后缀');
 const longFooter=!!p?.textContent?.includes('与私聊共用头像库和戳一戳功能');
 const cards=p?.querySelectorAll('section.rounded-2xl').length||0;
 const ready=width>=360&&noOverflow&&hasControls&&!longFooter&&cards>=2;
 document.body.dataset.ready=String(ready);
 document.getElementById('profile-visual-status')!.textContent=JSON.stringify({view,ready,width,noOverflow,hasControls,longFooter,cards});
},1300);
