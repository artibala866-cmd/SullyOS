/** Native chat components, not a CSS mock: rendered by the real decoration sample. */
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root=document.querySelector<HTMLElement>('#faint-silk-visual');
if (!root) throw Error('visual host missing');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-faint-silk')?.read();
 if(!preset)throw Error('Faint Silk preset missing');
 const scenes=['conversation','silent-letter-send','silent-letter-stop','reply','voice-playing','transfer','transfer-accepted','transfer-returned'];
 for(const scene of scenes){
  const {markup,css}=renderChatDecorationSample(preset,scene);
  const section=document.createElement('section');
  section.className='scene';section.dataset.scene=scene;
  section.innerHTML='<div class="beauty-preview-body">'+markup+'</div>';
  const style=document.createElement('style');style.textContent=css;section.prepend(style);
  const title=document.createElement('h2');title.textContent=scene;section.prepend(title);
  root.append(section);
 }
 // Real shared group message and packet renderers receive the same CSS.
 const group=document.createElement('section');
 group.className='scene';group.dataset.scene='group-chat';
 const demo={id:2001,role:'assistant' as const,type:'text' as const,charId:'preview',timestamp:1790386860000,content:'看这边！'};
 const common={
  userAvatar:BEAUTY_PREVIEW_AVATAR,onImageClick:()=>{},selectionMode:false,isSelected:false,
  onToggleSelect:()=>{},onLongPress:()=>{},onReply:()=>{},nameOf:()=>'示例角色',
  onPacketClick:()=>{},themeScopeClass:'sully-group-default-theme',isFirstInGroup:true,isLastInGroup:true,
  avatarShape:'circle' as const,avatarSize:'medium' as const,avatarMode:'grouped' as const,
  bubbleVariant:'modern' as const,messageSpacing:'compact' as const,showTimestamp:'never' as const,
 };
 const bubble={textColor:'#262626',backgroundColor:'rgba(239,239,239,.18)',borderRadius:16,opacity:1};
 const partner=React.createElement(GroupMessageItem,{...common,msg:demo,isUser:false,char:{id:'preview',name:'示例角色',avatar:BEAUTY_PREVIEW_AVATAR} as any,styleConfig:bubble});
 const self=React.createElement(GroupMessageItem,{...common,msg:{...demo,id:2002,role:'user' as const,content:'我来啦～'},isUser:true,styleConfig:bubble});
 const packet=React.createElement(GroupPacketCard,{msg:{...demo,id:2003,type:'transfer' as const,metadata:{}},nameOf:()=>'示例角色'});
 const receipt=React.createElement(GroupPacketCard,{msg:{...demo,id:2004,type:'transfer' as const,metadata:{packetReceipt:'claimed',claimantName:'示例角色',senderName:'我',amount:25}},nameOf:()=>'示例角色'});
 group.innerHTML='<h2>群聊消息 + 红包 + 回执</h2><div class="beauty-preview-body">'+
  renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sully-chat-group-root sample-chat'},React.createElement('div',{className:'sully-chat-messages sample-messages'},partner,self,packet,receipt)))+'</div>';
 const gs=document.createElement('style');gs.textContent=renderChatDecorationSample(preset,'conversation').css;group.prepend(gs);root.append(group);
 const $=(scene:string,selector:string)=>root.querySelector<HTMLElement>('[data-scene="'+scene+'"] '+selector);
 const style=(scene:string,selector:string)=>{const node=$(scene,selector);if(!node)throw Error(scene+' missing '+selector);return getComputedStyle(node);};
 const all=scenes.every(scene=>!!$(scene,'.sully-chat-root')&&!!$(scene,'.sully-chat-header')&&!!$(scene,'.sully-chat-inputbar'));
 const checks={
  realComponents:all,
  pairedPortraits:(()=>{
   const char=$('conversation','.sully-chat-avatar-pair .sully-chat-avatar') as HTMLImageElement|null;
   const user=$('conversation','.sully-chat-avatar-pair .sully-chat-pair-user-avatar') as HTMLImageElement|null;
   if(!char||!user)return false;
   const a=char.getBoundingClientRect(),b=user.getBoundingClientRect();
   return !!user.src && !!char.src && user.src!==char.src && user.complete && user.naturalWidth>0
      && b.left>=a.right+3 && a.width>=45 && b.width>=45 && a.height>=45 && b.height>=45;
  })(),
  noFixedPortrait:(()=>{
    const text=$('conversation','.sully-chat-name');
    return !!text && ['none','normal'].includes(getComputedStyle(text,'::after').content);
  })(),
  pairingWithinActions:(()=>{
    const pair=$('conversation','.sully-chat-avatar-pair')?.getBoundingClientRect();
    const back=$('conversation','.sully-chat-back')?.getBoundingClientRect();
    const generate=$('conversation','.sully-chat-trigger')?.getBoundingClientRect();
    return !!pair && !!back && !!generate && pair.left>=back.right-2 && pair.right<=generate.left+2;
  })(),
  groupNoExtraPortrait:!$('group-chat','.sully-chat-pair-user-avatar'),
  userGlass:style('conversation','.sully-bubble-user').backgroundColor==='rgba(239, 239, 239, 0.18)',
  aiGlass:style('conversation','.sully-bubble-ai').backgroundColor==='rgba(239, 239, 239, 0.18)',
  groupGlass:style('group-chat','.sully-bubble-ai').backgroundColor==='rgba(239, 239, 239, 0.18)',
  groupPacket:!!$('group-chat','.sully-chat-group-packet'),
  groupReceipt:!!$('group-chat','.sully-chat-group-packet-receipt'),
  transferGlass:style('transfer','.sully-chat-transfer-card').backgroundColor==='rgba(239, 239, 239, 0.18)',
  transferReceipt:!!$('transfer-accepted','.sully-chat-transfer-receipt')||!!$('transfer-returned','.sully-chat-transfer-receipt'),
  inputVisible:!!$('conversation','.sully-chat-textarea')&&style('conversation','.sully-chat-textarea').visibility!=='hidden',
  backVisible:style('conversation','.sully-chat-back').opacity==='1',
  sendVisible:!!$('silent-letter-send','.sully-chat-send-button')&&style('silent-letter-send','.sully-chat-send-button').visibility!=='hidden',
  sendIconActuallyVisible:style('silent-letter-send','.sully-chat-send-button[aria-label="发送文字"] > svg').visibility==='visible',
  stopVisible:!!$('silent-letter-stop','.sully-chat-trigger[title="停止生成"]')&&style('silent-letter-stop','.sully-chat-trigger').visibility!=='hidden',
  headerNoOverlap:(()=>{const a=$('conversation','.sully-chat-back')?.getBoundingClientRect(),b=$('conversation','.sully-chat-trigger')?.getBoundingClientRect();return !!a&&!!b&&a.right+2<=b.left;})(),
  inputHeight:(()=>{const a=$('conversation','.sully-chat-inputbar')?.getBoundingClientRect();return !!a&&a.height>=40&&a.height<=180;})(),
 };
 const out=document.createElement('output');out.textContent=JSON.stringify(checks,null,2);
 out.dataset.ready=Object.values(checks).every(Boolean)?'true':'false';
 root.append(out);
 if(out.dataset.ready!=='true')console.error('Faint Silk check failed',checks);
}catch(e){const out=document.createElement('output');out.dataset.ready='false';out.textContent=String(e);root.append(out);console.error(e);}
