/** Screenshot-only regression using real MessageItem and ChatHeaderShell renderers. */
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';

const root=document.querySelector<HTMLElement>('#silent-letter-visual');
if (!root) throw Error('visual host missing');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-silent-letter-dark')?.read();
 if (!preset) throw Error('built-in outfit missing');
 const scenes=['conversation','reply','voice-playing','transfer','transfer-accepted','transfer-returned','psyche','psyche-open'];
 for(const scene of scenes) {
  const {markup,css}=renderChatDecorationSample(preset,scene);
  const section=document.createElement('section');
  section.className='scene';
  section.dataset.scene=scene;
  section.innerHTML='<div class="beauty-preview-body">'+markup+'</div>';
  const style=document.createElement('style');style.textContent=css;section.prepend(style);
  const name=document.createElement('h2');name.textContent=scene;
  section.prepend(name);
  root.append(section);
 }
 const groupSection=document.createElement('section');
 groupSection.className='scene';
 groupSection.dataset.scene='group-chat';
 const demo={id:18021,role:'assistant' as const,type:'text' as const,charId:'preview',timestamp:1790386860000,content:'红包'};
 const baseGroupProps={
  userAvatar:BEAUTY_PREVIEW_AVATAR,onImageClick:()=>{},selectionMode:false,isSelected:false,
  onToggleSelect:()=>{},onLongPress:()=>{},onReply:()=>{},nameOf:()=>'示例角色',
  onPacketClick:()=>{},themeScopeClass:'sully-group-default-theme',isFirstInGroup:true,isLastInGroup:true,
  avatarShape:'circle' as const,avatarSize:'medium' as const,avatarMode:'grouped' as const,
  bubbleVariant:'modern' as const,messageSpacing:'compact' as const,showTimestamp:'never' as const,
 };
 const member=React.createElement(GroupMessageItem,{
  ...baseGroupProps,msg:{...demo,replyTo:{id:10,name:'我',content:'我们哪天出门？'},content:'明天下午去看花。'},
  isUser:false,char:{id:'preview',name:'示例角色',avatar:BEAUTY_PREVIEW_AVATAR} as any,
  styleConfig:preset.parts.bubbles!.ai,
 });
 const user=React.createElement(GroupMessageItem,{
  ...baseGroupProps,msg:{...demo,id:18022,role:'user',content:'好呀，我带上相机。'},
  isUser:true,styleConfig:preset.parts.bubbles!.user,
 });
 const packet=React.createElement(GroupPacketCard,{msg:{...demo,id:18023,type:'transfer',metadata:{}},nameOf:()=>'示例角色'});
 const receipt=React.createElement(GroupPacketCard,{msg:{...demo,id:18024,type:'transfer',metadata:{packetReceipt:'claimed',claimantName:'示例角色',senderName:'我',amount:25}},nameOf:()=>'示例角色'});
 groupSection.innerHTML='<h2>群聊原生消息 / 引用 / 红包 / 回执</h2><div class="beauty-preview-body">'+
  renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sully-chat-group-root sample-chat'},React.createElement('div',{className:'sully-chat-messages sample-messages'},member,user,packet,receipt)))+'</div>';
 const groupStyle=document.createElement('style');groupStyle.textContent=renderChatDecorationSample(preset,'conversation').css;groupSection.prepend(groupStyle);
 root.append(groupSection);
 const $=(scene:string,selector:string)=>root.querySelector<HTMLElement>('[data-scene="'+scene+'"] '+selector);
 const color=(scene:string,selector:string,property:'backgroundColor'|'color')=>{
  const el=$(scene,selector);
  if(!el) throw Error(scene+' missing '+selector);
  return getComputedStyle(el)[property];
 };
 const sceneHas=(scene:string,selector:string)=>!!$(scene,selector);
 const checks={
  presetParts:['layout','bubbles','psyche','css'].every(key=>key in preset.parts),
  userBubble:color('conversation','.sully-bubble-user','backgroundColor')==='rgb(26, 26, 26)',
  partnerBubble:color('conversation','.sully-bubble-ai','backgroundColor')==='rgb(238, 238, 238)',
  groupPartnerBubble:color('group-chat','.sully-bubble-ai','backgroundColor')==='rgb(238, 238, 238)',
  profileGlass:color('conversation','.sully-chat-profile','backgroundColor')==='rgba(255, 255, 255, 0.75)',
  originalNamePlate:getComputedStyle($('conversation','.sully-chat-message-group-first .sully-bubble-ai')!,'::before').content.includes('char'),
  originalInputPrompt:getComputedStyle($('conversation','.sully-chat-input-wrap')!,'::after').content.includes('imonly temporary 2 u'),
  avatarOnlyWhenVisible:[...root.querySelectorAll<HTMLElement>('[data-scene="conversation"] .sully-chat-message-avatar:not(.sully-chat-avatar-wrap)')].every(node=>{
    const hasImage=!!node.querySelector('.sully-chat-message-avatar-img');
    return hasImage || (getComputedStyle(node,'::after').content==='none' || getComputedStyle(node,'::after').content==='normal') && getComputedStyle(node).borderTopWidth==='0px';
  }),
  groupedAvatar:[...root.querySelectorAll<HTMLElement>('[data-scene="conversation"] .sully-chat-message-ai:not(.sully-chat-message-group-last) .sully-chat-message-avatar-slot')].every(slot=>!slot.querySelector('.sully-chat-avatar-wrap')),
  header:sceneHas('conversation','.sully-chat-header'),
  input:sceneHas('conversation','.sully-chat-inputbar'),
  reply:sceneHas('reply','.sully-chat-reply'),
  replyContrast:color('reply','.sully-bubble-user .sully-chat-reply','color')==='rgb(243, 243, 243)',
  voice:sceneHas('voice-playing','.sully-voice-bar'),
  transfer:sceneHas('transfer','.sully-chat-transfer-card[data-status="pending"]'),
  accepted:sceneHas('transfer-accepted','.sully-chat-transfer-receipt'),
  returned:sceneHas('transfer-returned','.sully-chat-transfer-receipt'),
  psyche:sceneHas('psyche-open','.sully-psyche-card'),
  groupMessage:sceneHas('group-chat','.sully-chat-message-sender')&&sceneHas('group-chat','.sully-bubble-ai'),
  groupReply:sceneHas('group-chat','.sully-chat-reply'),
  groupPacket:sceneHas('group-chat','.sully-chat-group-packet'),
  groupReceipt:sceneHas('group-chat','.sully-chat-group-packet-receipt'),
  safeControls:sceneHas('conversation','.sully-chat-send-button') || sceneHas('conversation','.sully-chat-actions-button'),
  noOverflow:![...root.querySelectorAll<HTMLElement>('.scene')].some(el=>el.scrollWidth>el.clientWidth+2),
 };
 root.dataset.ready=Object.values(checks).every(Boolean)?'true':'false';
 const output=document.createElement('output');output.id='silent-letter-checks';output.textContent=JSON.stringify(checks);root.prepend(output);
 if(root.dataset.ready==='false') throw Error('Visual assertions failed: '+JSON.stringify(checks));
} catch(error) {
 root.dataset.ready='false';root.dataset.error=String(error);
 const output=document.createElement('output');output.id='silent-letter-error';output.textContent=String(error);root.prepend(output);
}