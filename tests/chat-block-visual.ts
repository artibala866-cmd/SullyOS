import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ChatBlockModal from '../components/chat/ChatBlockModal';
import { changeChatBlock, configureCharacterBlocking, characterBlocksUser, userBlocksCharacter } from '../utils/chatBlock';
import type { ChatBlockState } from '../types';
const host = document.querySelector<HTMLElement>('#visual')!;
const root = createRoot(host);
let state: ChatBlockState | undefined;
let closed = 0;
const render = () => flushSync(() => root.render(React.createElement(ChatBlockModal, {
  characterName:'陈苍琛', state,
  onClose:()=>{closed++},
  onSetUserBlock:(blocked:boolean)=>{state=changeChatBlock(state,'user',blocked,{at:42,source:'manual'});render()},
  onSetCharacterAllowed:(allowed:boolean)=>{state=configureCharacterBlocking(state,allowed);render()},
})));
try {
  render();
  const find=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===name);
  const first = document.querySelector('section[role="dialog"]');
  const initial=!!first && !!find('拉黑角色') && first.textContent!.includes('允许角色自主拉黑我');
  flushSync(()=>find('拉黑角色')?.click());
  const confirmed=!!document.body.textContent?.includes('确认拉黑');
  flushSync(()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认拉黑')?.click());
  const separate= userBlocksCharacter(state) && !characterBlocksUser(state);
  const shown=!!find('解除拉黑角色') && first?.textContent?.includes('已拉黑');
  const element=document.querySelector<HTMLElement>('section[role="dialog"]');
  const surface=element && getComputedStyle(element);
  const lightSurface=!!surface && surface.backgroundColor==='rgb(250, 250, 250)';
  const input=document.querySelector<HTMLInputElement>('input[aria-label="允许角色自主拉黑我"]');
  flushSync(()=>input?.click());
  const independent=state?.allowCharacterBlockUser===false && userBlocksCharacter(state);
  const report={initial,confirmed,separate,shown,lightSurface,independent,closed};
  const out=document.createElement('output');out.textContent=JSON.stringify(report);host.append(out);
  host.dataset.blockVisualReady=Object.entries(report).filter(([k])=>k!=='closed').every(([,v])=>v===true)?'true':'false';
}catch(error){host.dataset.blockVisualReady='false';host.dataset.error=String(error);}
