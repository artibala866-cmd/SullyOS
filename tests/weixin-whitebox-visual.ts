/** Screenshot smoke: native Chat Header, MessageItem and GroupChat renderers, fictional data. */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';
const root=document.querySelector<HTMLElement>('#weixin-visual');
if(!root)throw Error('No host');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-weixin-baiyu')?.read();
 if(!preset)throw Error('Weixin built-in not found');
 for(const scene of ['conversation','reply','voice-playing','transfer','transfer-accepted','transfer-returned']){
  const {markup,css}=renderChatDecorationSample(preset,scene);
  const section=document.createElement('section');section.className='scene';section.dataset.scene=scene;
  section.innerHTML='<h2>'+scene+'</h2><div class="beauty-preview-body">'+markup+'</div>';
  const style=document.createElement('style');style.textContent=css;section.prepend(style);root.append(section);
 }
 const demo={id:25001,role:'assistant' as const,type:'text' as const,charId:'preview',timestamp:1790386860000,content:'周末一起去看海吧。'};
 const base={userAvatar:BEAUTY_PREVIEW_AVATAR,onImageClick:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},onLongPress:()=>{},onReply:()=>{},nameOf:()=>'示例角色',onPacketClick:()=>{},themeScopeClass:'sully-group-default-theme',isFirstInGroup:true,isLastInGroup:true,avatarShape:'circle' as const,avatarSize:'medium' as const,avatarMode:'grouped' as const,bubbleVariant:'modern' as const,messageSpacing:'default' as const,showTimestamp:'never' as const};
 const group=document.createElement('section');group.className='scene';group.dataset.scene='group';
 const groupMarkup=renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sully-chat-group-root sample-chat'},React.createElement('div',{className:'sully-chat-messages sample-messages'},React.createElement(GroupMessageItem,{...base,msg:demo,isUser:false,char:{id:'preview',name:'示例角色',avatar:BEAUTY_PREVIEW_AVATAR} as any,styleConfig:preset.parts.bubbles!.ai}),React.createElement(GroupMessageItem,{...base,msg:{...demo,id:25002,role:'user',content:'当然，我带相机！'},isUser:true,styleConfig:preset.parts.bubbles!.user}),React.createElement(GroupPacketCard,{msg:{...demo,id:25003,type:'transfer',metadata:{}},nameOf:()=>'示例角色'}),React.createElement(GroupPacketCard,{msg:{...demo,id:25004,type:'transfer',metadata:{packetReceipt:'claimed',claimantName:'示例角色',senderName:'我',amount:25}},nameOf:()=>'示例角色'}))));
 group.innerHTML='<h2>群聊双方消息、红包与领取回执</h2><div class="beauty-preview-body">'+groupMarkup+'</div>';
 const style=document.createElement('style');style.textContent=renderChatDecorationSample(preset,'conversation').css;group.prepend(style);root.append(group);
 const $=(scene:string,selector:string)=>root.querySelector<HTMLElement>('[data-scene="'+scene+'"] '+selector);

 const cssStyle=(scene:string,selector:string)=>{const el=$(scene,selector);return el?getComputedStyle(el):null};
 const bg=(scene:string,selector:string)=>cssStyle(scene,selector)?.backgroundColor;
 const same=(scene:string,selector:string,color:string)=>bg(scene,selector)===color;
 const inBounds=(scene:string)=>{
  const action=$(scene,'.sully-chat-actions-button'),field=$(scene,'.sully-chat-input-wrap'),send=$(scene,'.sully-chat-send-button');
  if(!action||!field||!send)return false;
  const a=action.getBoundingClientRect(),b=field.getBoundingClientRect(),c=send.getBoundingClientRect();
  return a.width>=25&&b.width>=70&&c.width>=25&&a.right<=b.left+1&&b.right<=c.left+1;
 };
 const checks={
  chatRoot:same('conversation','.sully-chat-root','rgb(237, 237, 237)'),
  header:same('conversation','.sully-chat-header','rgb(237, 237, 237)'),
  input:same('conversation','.sully-chat-inputbar','rgb(247, 247, 247)'),
  field:same('conversation','.sully-chat-input-wrap','rgb(255, 255, 255)'),
  userGreen:same('conversation','.sully-bubble-user','rgb(149, 236, 105)'),
  aiWhite:same('conversation','.sully-bubble-ai','rgb(255, 255, 255)'),
  reply:!!$('reply','.sully-chat-reply'),
  voice:!!$('voice-playing','.sully-voice-bar'),
  transfer:same('transfer','.sully-chat-transfer-card','rgb(250, 157, 59)'),
  accepted:!!$('transfer-accepted','.sully-chat-transfer-receipt'),
  returned:!!$('transfer-returned','.sully-chat-transfer-receipt'),
  groupBubble:same('group','.sully-bubble-ai','rgb(255, 255, 255)'),
  groupPacket:same('group','.sully-chat-group-packet','rgb(233, 167, 70)'),
  groupReceipt:!!$('group','.sully-chat-group-packet-receipt'),
  inputNoOverlap:inBounds('conversation'),
  transferColumnsSeparated:(()=>{
   const icon=$('transfer','.sully-chat-transfer-header .sully-chat-transfer-icon');
   const amount=$('transfer','.sully-chat-transfer-card > .sully-chat-transfer-amount');
   if(!icon||!amount)return false;
   const a=icon.getBoundingClientRect(),b=amount.getBoundingClientRect();
   return a.width>=32 && a.width<=45 && a.right<=b.left+1;
  })(),
  sendVisible:cssStyle('conversation','.sully-chat-send-button')?.visibility==='visible',
  backVisible:cssStyle('conversation','.sully-chat-back')?.visibility==='visible',
  noHorizontalOverflow:[...root.querySelectorAll<HTMLElement>('.scene')].every(e=>e.scrollWidth<=e.clientWidth+2)
 };
 root.dataset.ready=Object.values(checks).every(Boolean)?'true':'false';
 const output=document.createElement('output');output.id='weixin-checks';output.textContent=JSON.stringify(checks);root.prepend(output);
 if(root.dataset.ready!=='true')throw Error(JSON.stringify(checks));
} catch(e){root.dataset.ready='false';root.dataset.error=String(e);const output=document.createElement('output');output.textContent=String(e);root.prepend(output)}
