/**
 * Screenshot the ACTUAL MessageItem component; the original hidden text must
 * never be present in the resulting HTML or an assistant bubble.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MessageItem from '../components/chat/MessageItem';
import { PRESET_THEMES } from '../components/chat/ChatConstants';
import type { Message } from '../types';

// Inline fixture avatars keep screenshots deterministic without missing assets.
const charAvatar = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#a7b5ce"/><text x="48" y="61" text-anchor="middle" font-size="38" fill="#fff" font-family="Noto Sans CJK SC, sans-serif">林</text></svg>');
const userAvatar = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#b7c8b9"/><text x="48" y="61" text-anchor="middle" font-size="38" fill="#fff" font-family="Noto Sans CJK SC, sans-serif">我</text></svg>');
const charId='visual-character-recall';
const now=Date.now();
const messages: Message[]=[
  {id:2001,charId,role:'user',type:'text',timestamp:now-3000,content:'你是不是喜欢我啊？'},
  {id:2002,charId,role:'assistant',type:'text',timestamp:now-2000,content:'你猜'},
  {id:2003,charId,role:'assistant',type:'text',timestamp:now-1000,content:'[消息已撤回]',
   metadata:{recalledAt:now,recalledBy:'assistant',recalledOriginalContent:'敏感原文不该出现'}},
  {id:2004,charId,role:'assistant',type:'text',timestamp:now,content:'……你少自恋了'},
];
const root=document.querySelector<HTMLElement>('#recall-chat');
if(!root)throw Error('Missing real chat fixture');
try{
  for(const msg of messages){
    const wrap=document.createElement('section');
    wrap.className='recall-case sully-chat-root';
    wrap.dataset.messageId=String(msg.id);
    wrap.innerHTML=renderToStaticMarkup(React.createElement(MessageItem,{
      msg,activeTheme:PRESET_THEMES.forest,isFirstInGroup:true,isLastInGroup:true,
      charAvatar,charName:'林屿',userAvatar,onLongPress:()=>{},
      onReply:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},
      showTimestamp:'never',
    }));
    root.appendChild(wrap);
  }
  const target=root.querySelector<HTMLElement>('[data-message-id="2003"]');
  const status=target?.querySelector<HTMLElement>('[role="status"]');
  const checks={
    targetHasStatus:!!status,
    label:status?.textContent?.trim()==='林屿撤回了一条消息',
    originalTextHidden:!root.textContent?.includes('敏感原文不该出现'),
    oldBubbleGone:!!target && target.querySelectorAll('.sully-chat-message-bubble,.sully-chat-text-bubble').length===0
        && !target.textContent?.includes('敏感原文不该出现'),
    normalRepliesVisible:root.textContent?.includes('你猜')&&root.textContent?.includes('……你少自恋了'),
    centered:!!status && Math.abs(status.getBoundingClientRect().left
      + status.getBoundingClientRect().width/2 - root.getBoundingClientRect().left - root.getBoundingClientRect().width/2)<4,
  };
  const output=document.createElement('output');
  output.id='recall-visual-checks';output.hidden=true;output.textContent=JSON.stringify(checks);
  document.body.appendChild(output);
  document.body.dataset.recallVisualReady=Object.values(checks).every(Boolean)?'true':'false';
}catch(error){
  document.body.dataset.recallVisualReady='false';
  document.body.dataset.recallVisualError=String(error instanceof Error?error.stack||error.message:error);
}
