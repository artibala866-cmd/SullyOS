/** Screenshot smoke: native Chat Header, MessageItem and GroupChat renderers, fictional data. */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';
const root=document.querySelector<HTMLElement>('#friend-rain-visual');
if(!root)throw Error('No host');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-friend-request-rain')?.read();
 if(!preset)throw Error('Friend Rain not found');
 for(const scene of ['conversation','silent-letter-send','silent-letter-stop','reply','voice-playing','transfer','transfer-accepted','transfer-returned']){
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

 const rect=(scene:string,sel:string)=>$(scene,sel)?.getBoundingClientRect();
 const overlap=(a:DOMRect|undefined,b:DOMRect|undefined)=>!!a&&!!b&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
 const cssStyle=(scene:string,sel:string,pseudo?:string)=>{const el=$(scene,sel);if(!el)throw Error('missing '+scene+' '+sel);return getComputedStyle(el,pseudo)};
 const checks={
  nativePrivate:!!$('conversation','.sully-chat-header')&&!!$('conversation','.sully-chat-composer'),
  nativeGroup:!!$('group','.sully-bubble-ai')&&!!$('group','.sully-bubble-user'),
  groupPacket:!!$('group','.sully-chat-group-packet'),
  groupReceipt:!!$('group','.sully-chat-group-packet-receipt'),
  transfer:cssStyle('transfer','.sully-chat-transfer-card').backgroundImage.includes('gradient'),
  accepted:!!$('transfer-accepted','.sully-chat-transfer-receipt'),
  returned:!!$('transfer-returned','.sully-chat-transfer-receipt'),
  reply:!!$('reply','.sully-chat-reply'),
  voice:!!$('voice-playing','.sully-voice-bar'),
  hearts:cssStyle('conversation','.sully-bubble-user','::after').content.includes('♥'),
  blackBubble:cssStyle('conversation','.sully-bubble-user').backgroundColor==='rgb(0, 0, 0)',
  whiteBubble:cssStyle('conversation','.sully-bubble-ai').backgroundColor==='rgb(255, 255, 255)',
  backReplaced:cssStyle('conversation','.sully-chat-back > svg').opacity==='0'
   && cssStyle('conversation','.sully-chat-back','::after').content!=='none',
  actionsReplaced:cssStyle('conversation','.sully-chat-actions-button > svg').opacity==='0'
   && cssStyle('conversation','.sully-chat-actions-button','::after').content!=='none',
  lightningVisible:cssStyle('conversation','.sully-chat-trigger > svg').opacity==='1',
  stopAvailable:!!$('silent-letter-stop','.sully-chat-trigger[title="停止生成"]'),
  sendAvailable:!!$('silent-letter-send','.sully-chat-send-button'),
  headerSeparated:!overlap(rect('conversation','.sully-chat-back'),rect('conversation','.sully-chat-trigger')),
  composerSeparated:!overlap(rect('conversation','.sully-chat-actions-button'),rect('conversation','.sully-chat-input-wrap'))
    &&!overlap(rect('conversation','.sully-chat-input-wrap'),rect('conversation','.sully-chat-send-button')),
  composerReadable:(rect('conversation','.sully-chat-input-wrap')?.width||0)>=115,
  clickIntact:['.sully-chat-back','.sully-chat-trigger','.sully-chat-actions-button','.sully-chat-send-button'].every(s=>cssStyle('conversation',s).pointerEvents!=='none'),
  transferInteractive:cssStyle('transfer','.sully-chat-transfer-card').pointerEvents!=='none',
  transferDecorated:cssStyle('transfer','.sully-chat-transfer-card .sully-chat-transfer-watermark').display==='none'
    && cssStyle('transfer','.sully-chat-transfer-card .sully-chat-transfer-icon').backgroundImage.includes('IMG-3703.png')
    && cssStyle('transfer','.sully-chat-transfer-card .sully-chat-transfer-icon > svg').display==='none',
  headerPictureRoom:(rect('conversation','.sully-chat-header')?.height||0)>=90,
  noOverflow:[...root.querySelectorAll<HTMLElement>('.scene')].every(e=>e.scrollWidth<=e.clientWidth+2)
 };
 root.dataset.ready=Object.values(checks).every(Boolean)?'true':'false';
 const output=document.createElement('output');output.textContent=JSON.stringify(checks,null,2);root.prepend(output);
 if(root.dataset.ready!=='true')throw Error(JSON.stringify(checks));
}catch(e){root.dataset.ready='false';root.dataset.error=String(e);const output=document.createElement('output');output.textContent=String(e);root.prepend(output)}
