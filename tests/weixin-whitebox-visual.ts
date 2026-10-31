/** Screenshot smoke: native Chat Header, MessageItem and GroupChat renderers, fictional data. */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import {makePacketMeta} from '../utils/groupChat/redpacket';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';
const root=document.querySelector<HTMLElement>('#weixin-visual');
if(!root)throw Error('No host');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-weixin-baiyu')?.read();
 if(!preset)throw Error('Weixin built-in not found');
 for(const scene of ['conversation','weixin-send','reply','voice-playing','transfer','transfer-accepted','transfer-returned','image','emoji','interaction','chat_forward','sim_card','system']){
  const {markup,css}=renderChatDecorationSample(preset,scene);
  const section=document.createElement('section');section.className='scene';section.dataset.scene=scene;
  section.innerHTML='<h2>'+scene+'</h2><div class="beauty-preview-body">'+markup+'</div>';
  const style=document.createElement('style');style.textContent=css;section.prepend(style);root.append(section);
 }
 const demo={id:25001,role:'assistant' as const,type:'text' as const,charId:'preview',timestamp:1790386860000,content:'周末一起去看海吧。'};
 const base={userAvatar:BEAUTY_PREVIEW_AVATAR,onImageClick:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},onLongPress:()=>{},onReply:()=>{},nameOf:()=>'示例角色',onPacketClick:()=>{},themeScopeClass:'sully-group-default-theme',isFirstInGroup:true,isLastInGroup:true,avatarShape:'circle' as const,avatarSize:'medium' as const,avatarMode:'grouped' as const,bubbleVariant:'modern' as const,messageSpacing:'default' as const,showTimestamp:'never' as const};
 const group=document.createElement('section');group.className='scene';group.dataset.scene='group';
 const pendingPacket=makePacketMeta({packetType:'direct',totalAmount:25,targetId:'preview',note:'恭喜发财',now:Date.now()});
 const acceptedPacket={...pendingPacket,status:'done' as const,claims:[{claimantId:'preview',amount:25,at:Date.now()}]};
 const groupMarkup=renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sully-chat-group-root sample-chat'},React.createElement('div',{className:'sully-chat-messages sample-messages'},React.createElement(GroupMessageItem,{...base,msg:demo,isUser:false,char:{id:'preview',name:'示例角色',avatar:BEAUTY_PREVIEW_AVATAR} as any,styleConfig:preset.parts.bubbles!.ai}),React.createElement(GroupMessageItem,{...base,msg:{...demo,id:25002,role:'user',content:'当然，我带相机！'},isUser:true,styleConfig:preset.parts.bubbles!.user}),React.createElement(GroupPacketCard,{msg:{...demo,id:25003,type:'transfer',metadata:{}},nameOf:()=>'示例角色'}),React.createElement(GroupPacketCard,{msg:{...demo,id:25004,type:'transfer',metadata:{packetReceipt:'claimed',claimantName:'示例角色',senderName:'我',amount:25}},nameOf:()=>'示例角色'}),React.createElement(GroupPacketCard,{msg:{...demo,id:25005,type:'transfer',metadata:pendingPacket},nameOf:()=>'示例角色'}),React.createElement(GroupPacketCard,{msg:{...demo,id:25006,type:'transfer',metadata:acceptedPacket},nameOf:()=>'示例角色'}))));
 group.innerHTML='<h2>群聊双方消息、红包与领取回执</h2><div class="beauty-preview-body">'+groupMarkup+'</div>';
 const style=document.createElement('style');style.textContent=renderChatDecorationSample(preset,'conversation').css;group.prepend(style);root.append(group);
 const $=(scene:string,selector:string)=>root.querySelector<HTMLElement>('[data-scene="'+scene+'"] '+selector);

 const cssStyle=(scene:string,selector:string)=>{const el=$(scene,selector);return el?getComputedStyle(el):null};
 const bg=(scene:string,selector:string)=>cssStyle(scene,selector)?.backgroundColor;
 const same=(scene:string,selector:string,color:string)=>bg(scene,selector)===color;
 const inBounds=(scene:string)=>{
  const action=$(scene,'.sully-chat-actions-button'),field=$(scene,'.sully-chat-input-wrap'),send=$(scene,'.sully-chat-send-button'),voice=$(scene,'.sully-chat-voice-trigger');
  if(!action||!field||!send||!voice)return false;
  const a=action.getBoundingClientRect(),b=field.getBoundingClientRect(),v=voice.getBoundingClientRect();
  return a.width>=25 && b.width>=70 && v.width>=25 && v.right<=b.left+2 && b.right<=a.left+2
   && getComputedStyle(send).display==='none';
 };
 const dark=window.matchMedia('(prefers-color-scheme: dark)').matches;
 const expected=(light:string,night:string)=>dark?night:light;
 const checks={
  chatRoot:same('conversation','.sully-chat-root',expected('rgb(237, 237, 237)','rgb(24, 24, 24)')),
  header:same('conversation','.sully-chat-header',expected('rgb(237, 237, 237)','rgb(17, 17, 17)')),
  input:same('conversation','.sully-chat-inputbar',expected('rgb(247, 247, 247)','rgb(23, 23, 23)')),
  field:same('conversation','.sully-chat-input-wrap',expected('rgb(255, 255, 255)','rgb(41, 41, 41)')),
  userGreen:same('conversation','.sully-bubble-user',expected('rgb(149, 236, 105)','rgb(62, 181, 117)')),
  aiWhite:same('conversation','.sully-bubble-ai',expected('rgb(255, 255, 255)','rgb(42, 42, 44)')),

  aiTextLegible:(()=>{
   const el=$('conversation','.sully-bubble-ai .sully-facebook-bubble-text');
   if(!el)return false;
   const st=getComputedStyle(el);
   return st.color===expected('rgb(23, 23, 23)','rgb(238, 238, 238)');
  })(),
  groupAiTextLegible:(()=>{
   const el=$('group','.sully-bubble-ai > .relative.z-10.select-text');
   if(!el)return false;
   const st=getComputedStyle(el);
   return st.color===expected('rgb(23, 23, 23)','rgb(238, 238, 238)');
  })(),

  reply:!!$('reply','.sully-chat-reply'),
  voice:!!$('voice-playing','.sully-voice-bar'),
  transfer:same('transfer','.sully-chat-transfer-card','rgb(250, 157, 59)'),
  accepted:!!$('transfer-accepted','.sully-chat-transfer-receipt'),
  returned:!!$('transfer-returned','.sully-chat-transfer-receipt'),
  groupBubble:same('group','.sully-bubble-ai',expected('rgb(255, 255, 255)','rgb(42, 42, 44)')),
  groupPacket:same('group','.sully-chat-group-packet','rgb(233, 167, 70)'),
  groupReceipt:!!$('group','.sully-chat-group-packet-receipt'),
  inputNoOverlap:inBounds('conversation'),
  filledInputRealSend:(()=>{
   const menu=$('weixin-send','.sully-chat-actions-button'),field=$('weixin-send','.sully-chat-input-wrap'),send=$('weixin-send','.sully-chat-send-button');
   return !!menu&&!!field&&!!send&&getComputedStyle(menu).display==='none'
     &&getComputedStyle(send).display!=='none'
     &&getComputedStyle(send.querySelector('svg')!).visibility==='visible'
     &&field.getBoundingClientRect().right<=send.getBoundingClientRect().left+2;
  })(),
  headerNoExtraHeight:(()=>{
   const h=$('conversation','.sully-chat-header');
   return !!h && h.getBoundingClientRect().height<=80;
  })(),
  realActionsHaveMatchingIcons:(()=>{
   const menu=$('conversation','.sully-chat-actions-button'),send=$('conversation','.sully-chat-send-button');
   const menuIcon=menu?.querySelector('svg');
   return !!menu&&!!send&&!!menuIcon&&getComputedStyle(menuIcon).visibility==='visible'
     && getComputedStyle(menu,'::before').content==='none';
  })(),
  nativePhotoDimensions:(()=>{
   const img=$('image','.chat-image-thumbnail img');
   if(!img)return false;
   const st=getComputedStyle(img);
   return parseFloat(st.maxWidth)<=170.1 && parseFloat(st.maxHeight)<=200.1 &&
     st.borderTopLeftRadius==='5px';
  })(),
  nativeStickerDimensions:(()=>{
   const img=$('emoji','.sully-emoji-msg');
   return !!img && parseFloat(getComputedStyle(img).maxWidth)<=110.1;
  })(),
  interactionPill:(()=>{
   const el=$('interaction','.sully-chat-interaction .group.relative.cursor-pointer > div');
   if(!el)return false;
   return getComputedStyle(el).borderTopLeftRadius==='5px';
  })(),
  forwardCard:(()=>{
   const el=$('chat_forward','.sully-chat-card[data-card-kind="chat_forward"]');
   return !!el && !!el.querySelector('.sully-chat-card-content');
  })(),
  simCardPreservesContent:!!$('sim_card','.sully-chat-card[data-card-kind="sim_card"]') && !!$('sim_card','.sully-chat-card[data-card-kind="sim_card"] .sully-chat-card-content')?.textContent?.trim(),
  groupPacketStates:(()=>{
   const pending=$('group','.sully-chat-group-packet[data-status="pending"]');
   const done=$('group','.sully-chat-group-packet[data-status="done"]');
   return !!pending&&!!done&&getComputedStyle(pending).backgroundColor!==getComputedStyle(done).backgroundColor;
  })(),
  groupPacketTextVisible:(()=>{
   const done=$('group','.sully-chat-group-packet[data-status="done"]');
   return !!done&&done.textContent?.includes('恭喜发财')&&done.textContent?.includes('已收下');
  })(),
  nativeLightningVisible:(()=>{
   const icon=$('conversation','.sully-chat-trigger svg'),trigger=$('conversation','.sully-chat-trigger');
   return !!icon && !!trigger && cssStyle('conversation','.sully-chat-trigger')?.position==='absolute'
    && getComputedStyle(icon).visibility==='visible'
    && getComputedStyle(trigger,'::after').content==='none';
  })(),
  headerActionsNonOverlapping:(()=>{
   const back=$('conversation','.sully-chat-back');
   const phone=$('conversation','.sully-chat-header button[aria-label="电话"]');
   const reply=$('conversation','.sully-chat-trigger');
   const name=$('conversation','.sully-chat-name');
   const header=$('conversation','.sully-chat-header');
   if(!back||!phone||!reply||!name||!header)return false;
   const a=back.getBoundingClientRect(),b=phone.getBoundingClientRect(),d=reply.getBoundingClientRect(),n=name.getBoundingClientRect(),h=header.getBoundingClientRect();
   return a.right<n.left+4&&n.right<b.left+4&&b.right<=d.left+1&&d.right<=h.right+1
    &&a.width>=28&&b.width>=28&&d.width>=28
    &&Math.abs(b.top-d.top)<8;
  })(),
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
 if(root.dataset.ready!=='true'){
  const rect=(el:HTMLElement|null)=>{const r=el?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}:null;};
  const metrics={
   card:rect($('transfer','.sully-chat-transfer-card')),
   header:rect($('transfer','.sully-chat-transfer-header')),
   icon:rect($('transfer','.sully-chat-transfer-header .sully-chat-transfer-icon')),
   amount:rect($('transfer','.sully-chat-transfer-card > .sully-chat-transfer-amount')),
   cardDisplay:cssStyle('transfer','.sully-chat-transfer-card')?.display,
   headerDisplay:cssStyle('transfer','.sully-chat-transfer-header')?.display,
   iconDisplay:cssStyle('transfer','.sully-chat-transfer-icon')?.display,
  };
  throw Error(JSON.stringify({checks,metrics}));
 }
} catch(e){root.dataset.ready='false';root.dataset.error=String(e);const output=document.createElement('output');output.textContent=String(e);root.prepend(output)}
