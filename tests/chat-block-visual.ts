import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ChatBlockModal from '../components/chat/ChatBlockModal';
import ChatBlockDeliveryStatus from '../components/chat/ChatBlockDeliveryStatus';
import MessageItem from '../components/chat/MessageItem';
import type { ChatTheme } from '../types';
import { changeChatBlock, configureCharacterBlocking, characterBlocksUser, userBlocksCharacter } from '../utils/chatBlock';
import type { ChatBlockState, Message } from '../types';

const host = document.querySelector<HTMLElement>('#visual')!;
const root = createRoot(host);
let state: ChatBlockState | undefined;
const message = (role: Message['role'], metadata?: Message['metadata']) => ({ role, metadata } as Message);
let closed = 0;
const transparentAvatar = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const theme = { user: {}, ai: {} } as ChatTheme;
const realMessage = (role: Message['role'], id: number, failed = false): Message => ({
  id, charId: 'c1', role, type: 'text', timestamp: 1730500000000 + id,
  content: role === 'user' ? '用户拉黑后仍然能够发消息' : '角色看到了，但认为自己的消息没送达',
  metadata: failed ? (role === 'user' ? { chatBlockRejected: true } : { chatBlockSendFailed: true }) : {},
} as Message);
const realItem = (role: Message['role'], id: number, failed = false) => React.createElement(MessageItem, {
  msg: realMessage(role, id, failed), activeTheme: theme,
  isFirstInGroup: true, isLastInGroup: true,
  charName: '陈苍琛', charAvatar: transparentAvatar, userAvatar: transparentAvatar,
  onLongPress: () => {}, onReply: () => {}, selectionMode: false,
  isSelected: false, onToggleSelect: () => {}, showTimestamp: 'never',
});

const chatPreview = React.createElement('div', {
  className: 'mx-auto max-w-md space-y-4 px-5 pt-16', id: 'delivery-visual',
}, [
  React.createElement('div', {key:'user', className:'ml-auto w-fit max-w-[80%] rounded-2xl bg-white p-4 text-sm shadow'},
    ['我拉黑后仍能发消息，等你怎么回复。',
     React.createElement('div', {id:'blocked-user-message',key:'status'},
       React.createElement(ChatBlockDeliveryStatus, {message:message('user')}))]),
  React.createElement('div', {key:'char', className:'mr-auto w-fit max-w-[80%] rounded-2xl bg-white p-4 text-sm shadow'},
    ['我看见了消息，可我的回复显示发送失败。',
     React.createElement('div', {id:'blocked-char-reply', key:'status'},
       React.createElement(ChatBlockDeliveryStatus, {message:message('assistant',{chatBlockSendFailed:true})}))]),
  React.createElement('div', {id:'rejected-user',key:'denied',className:'ml-auto w-fit max-w-[80%] rounded-2xl bg-white p-3'},
    React.createElement(ChatBlockDeliveryStatus, {message:message('user',{chatBlockRejected:true})})),
]);
const render = () => flushSync(() => root.render(React.createElement(React.Fragment, null,
  React.createElement('div', {id: 'real-message-render', key: 'real', className: 'mx-auto max-w-md mt-6'}, [
    React.createElement('div',{id: 'real-user-normal',key:'user'},realItem('user',501,false)),
    React.createElement('div',{id: 'real-char-failed',key:'char'},realItem('assistant',502,true)),
    React.createElement('div',{id: 'real-user-rejected',key:'rejected'},realItem('user',503,true)),
  ]),
  chatPreview,
  React.createElement(ChatBlockModal, {
    characterName:'陈苍琛', state, onClose:()=>{closed++},
    onSetUserBlock:(blocked:boolean)=>{state=changeChatBlock(state,'user',blocked,{at:42,source:'manual'});render()},
    onSetCharacterAllowed:(allowed:boolean)=>{state=configureCharacterBlocking(state,allowed);render()},
  })
)));
try {
  render();
  // Tailwind CDN 在 React 首帧之后异步扫描类名；等真实 CSS 注入后再做像素色彩验收。
  await new Promise<void>(resolve => setTimeout(resolve, 1500));
  const find=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===name);
  const first=document.querySelector('section[role="dialog"]')!;
  const initial=!!first && !!find('拉黑角色') && first.textContent!.includes('拉黑对方')
    && !first.textContent!.includes('你拉黑了') && !first.textContent!.includes('拉黑了你');
  const indicator=document.querySelector<HTMLElement>('#blocked-char-reply [aria-label="消息发送失败"]');
  const integrated=!!document.querySelector('#real-char-failed .sully-chat-block-failed[data-chat-block-delivery="char-send-failed"]')
    && !!document.querySelector('#real-user-rejected .sully-chat-block-failed[data-chat-block-delivery="user-rejected"]')
    && !document.querySelector('#real-user-normal .sully-chat-block-failed')
    && document.querySelectorAll('#real-char-failed .sully-chat-block-failed').length === 1;
  // Chrome 156 会把 Tailwind 颜色保留为 oklch()/color(srgb)，
  // 不能用 rgb() 文本解析；由浏览器画进 1x1 canvas 后读取实际 sRGB 颜色。
  const readColor=(element:Element | null):number[]=>{
    if(!element)return [0,0,0,0];
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)return [0,0,0,0];
    ctx.fillStyle=getComputedStyle(element).backgroundColor;
    ctx.fillRect(0,0,1,1);
    return Array.from(ctx.getImageData(0,0,1,1).data);
  };
  const [red,green,blue,redAlpha]=readColor(indicator);
  const deliveryDirection=!!indicator && redAlpha > 0 && red > 120 && red > green * 1.3 && red > blue * 1.3
    && !document.querySelector('#blocked-user-message [role="status"]')
    && !!document.querySelector('#rejected-user [role="status"]');
  flushSync(()=>find('拉黑角色')?.click());
  const confirmed=!!document.body.textContent?.includes('确认拉黑');
  flushSync(()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='确认拉黑')?.click());
  const separate= userBlocksCharacter(state) && !characterBlocksUser(state);
  const shown=!!find('解除拉黑角色') && first.textContent!.includes('解除拉黑') && !first.textContent!.includes('拉黑了你');
  const surface=first && getComputedStyle(first);
  const [sr,sg,sb,lightAlpha]=readColor(first);
  const lightSurface=!!surface && lightAlpha > 0 && sr >= 235 && sg >= 235 && sb >= 235;
  const advanced=document.querySelector<HTMLDetailsElement>('details');
  if(advanced) advanced.open=true;
  const input=document.querySelector<HTMLInputElement>('input[aria-label="允许角色自主拉黑我"]');
  flushSync(()=>input?.click());
  const independent=state?.allowCharacterBlockUser===false && userBlocksCharacter(state);
  state=configureCharacterBlocking(state,true);
  state=changeChatBlock(state,'character',true,{at:250});
  render();
  const hiddenCharacterBlock=characterBlocksUser(state)
    && !document.querySelector('section[role="dialog"]')?.textContent?.includes('拉黑了你');
  // 截图回到用户真正打开设置时的「拉黑对方」初始态。
  state=undefined;
  render();
  const closedDetails=document.querySelector<HTMLDetailsElement>('details');
  if(closedDetails) closedDetails.open=false;
  const report={initial,deliveryDirection,integrated,confirmed,separate,shown,lightSurface,independent,hiddenCharacterBlock,closed,
    debugColors:{
      redCss:indicator ? getComputedStyle(indicator).backgroundColor : '',
      sampleRed:[red,green,blue,redAlpha],
      surfaceCss:surface?.backgroundColor,
      sampleSurface:[sr,sg,sb,lightAlpha],
      integratedElements: {
        charFailed: !!document.querySelector('#real-char-failed .sully-chat-block-failed[data-chat-block-delivery="char-send-failed"]'),
        userRejected: !!document.querySelector('#real-user-rejected .sully-chat-block-failed[data-chat-block-delivery="user-rejected"]'),
        normalHasMarker: !!document.querySelector('#real-user-normal .sully-chat-block-failed'),
        charMarkerCount: document.querySelectorAll('#real-char-failed .sully-chat-block-failed').length,
      },
    },
  };
  const out=document.createElement('output');out.style.display='none';out.textContent=JSON.stringify(report);host.append(out);
  host.dataset.blockVisualReady=Object.entries(report).filter(([k])=>k!=='closed' && k!=='debugColors').every(([,v])=>v===true)?'true':'false';
}catch(error){host.dataset.blockVisualReady='false';host.dataset.error=String(error);}
