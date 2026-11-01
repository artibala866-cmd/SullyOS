import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MessageItem from '../components/chat/MessageItem';
import type { Message } from '../types';

const host = document.getElementById('music-invite-visual')!;
const theme = { id:'visual', name:'Visual', user:{}, ai:{} } as any;
const makeInvite = (id: number, inviter: 'user' | 'char'): Message => ({
  id, charId:'music-test-char',
  role: inviter === 'user' ? 'user' : 'assistant',
  type:'system', content:'[一起听邀请]', timestamp:Date.now(),
  metadata:{ musicListenInvite:true, inviter, status:'pending', invitedAt:Date.now() },
});
const cards=[
  {message:makeInvite(201,'user'), selection:false, label:'你发出的邀请（正常）'},
  {message:makeInvite(202,'char'), selection:false, label:'Char 发出的邀请（正常）'},
  {message:makeInvite(301,'user'), selection:true, label:'你发出的邀请（多选）'},
  {message:makeInvite(302,'char'), selection:true, label:'Char 发出的邀请（多选）'},
];
function Fixture() {
  const [selected,setSelected]=useState<number[]>([]);
  return <div>{cards.map(({message,selection,label})=><section key={message.id} className="chat-row">
    <div className="section">{label}</div>
    <MessageItem msg={message} isFirstInGroup isLastInGroup
      activeTheme={theme} charName="宝宝狗" charAvatar="" userAvatar=""
      onLongPress={()=>{}} onReply={()=>{}}
      selectionMode={selection} isSelected={selected.includes(message.id)}
      onToggleSelect={(id)=>setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}/>
  </section>)}</div>;
}
try {
  const root=createRoot(host);
  flushSync(()=>root.render(<Fixture/>));
  const get=(id:number)=>host.querySelector<HTMLElement>(`[data-music-invite-card="${id}"]`);
  const originalUser=get(201), originalChar=get(202);
  const firstButton=get(301)?.querySelector<HTMLButtonElement>('button[aria-label="选择一起听邀请"]');
  const second=get(302);
  flushSync(()=>firstButton?.click());
  flushSync(()=>second?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
  const bothSelected=!!get(301)?.querySelector('button[aria-pressed="true"]')
    && !!get(302)?.querySelector('button[aria-pressed="true"]');
  const disabledInSelection=[301,302].every(id=>
    [...(get(id)?.querySelectorAll<HTMLButtonElement>('button')||[])]
      .filter(btn=>btn.getAttribute('aria-label')!=='选择一起听邀请')
      .every(btn=>btn.disabled));
  const originalActions=!!originalUser?.textContent?.includes('撤回邀请')
    && !!originalChar?.textContent?.includes('接受')
    && !!originalChar?.textContent?.includes('拒绝');
  const noClipping=[201,202,301,302].every(id=>{
    const r=get(id)?.getBoundingClientRect();
    return !!r && r.width>240 && r.left>=-1 && r.right<=innerWidth+1;
  });
  const report={originalActions,bothSelected,disabledInSelection,noClipping};
  host.dataset.musicInviteVisualReady=Object.values(report).every(Boolean)?'true':'false';
  const out=document.createElement('output');out.id='music-invite-visual-report';
  out.textContent=JSON.stringify(report);host.append(out);
}catch(error){
  host.dataset.musicInviteVisualReady='false';
  host.dataset.error=String(error);
}