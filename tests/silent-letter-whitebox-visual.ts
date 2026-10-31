/** Screenshot-only regression using real MessageItem and ChatHeaderShell renderers. */
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {resolveLegacySilentLetterCss} from '../components/chat/BlobRefStyle';
import React from 'react';
import ChatHeaderShell from '../components/chat/ChatHeaderShell';
import {renderToStaticMarkup} from 'react-dom/server';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';

const root=document.querySelector<HTMLElement>('#silent-letter-visual');
if (!root) throw Error('visual host missing');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-silent-letter-dark')?.read();
 if (!preset) throw Error('built-in outfit missing');
 const scenes=['silent-letter-narrow','installed-v2','conversation','silent-letter-send','silent-letter-stop','reply','voice-playing','transfer','transfer-accepted','transfer-returned','psyche','psyche-open','sim_card'];
 for(const scene of scenes) {
  // A returning user's CSS is stored in their character/global settings and
  // is not changed when the built-in JSON is updated. Simulate exactly that.
  const marker='/* 11. 贴图是真正的替换图标';
  const persistedV2=preset.parts.css!.slice(0,preset.parts.css!.indexOf(marker));
  const fixture=scene==='installed-v2'
    ? {...preset,parts:{...preset.parts,css:persistedV2}}
    : preset;
  const {markup,css}=renderChatDecorationSample(fixture,scene==='installed-v2'?'conversation':scene);
  const runtimeCss=scene==='installed-v2'
    ? css.replace(persistedV2,resolveLegacySilentLetterCss(persistedV2))
    : css;
  const section=document.createElement('section');
  section.className='scene';
  section.dataset.scene=scene;
  if(scene==='silent-letter-narrow')section.style.width='320px';
  section.innerHTML='<div class="beauty-preview-body">'+markup+'</div>';
  const style=document.createElement('style');style.textContent=runtimeCss+(scene==='silent-letter-narrow'?'\n.beauty-preview-body{width:320px!important;}':'');section.prepend(style);
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
 const groupHeader=React.createElement(ChatHeaderShell,{
  selectionMode:false,selectedCount:0,onCancelSelection:()=>{},
  activeCharacter:{id:'demo-group',name:'示例群聊',avatar:BEAUTY_PREVIEW_AVATAR,activeBuffs:[]},
  isTyping:false,isSummarizing:false,lastTokenUsage:0,statusText:'3 成员',
  extraAction:{label:'群聊记忆规则',icon:React.createElement('svg',{viewBox:'0 0 24 24'},React.createElement('path',{d:'M12 4v16'})),onClick:()=>{}},
  onClose:()=>{},onTriggerAI:()=>{},onShowCharsPanel:()=>{},
  headerStyle:'default',avatarShape:'circle',headerAlign:'left',headerDensity:'default',statusStyle:'subtle',chromeStyle:'soft',hideBuffs:true
 });
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
  renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sully-chat-group-root sample-chat'},groupHeader,React.createElement('div',{className:'sully-chat-messages sample-messages'},member,user,packet,receipt)))+'</div>';
 const groupStyle=document.createElement('style');groupStyle.textContent=renderChatDecorationSample(preset,'conversation').css;groupSection.prepend(groupStyle);
 root.append(groupSection);
 const $=(scene:string,selector:string)=>root.querySelector<HTMLElement>('[data-scene="'+scene+'"] '+selector);
 const color=(scene:string,selector:string,property:'backgroundColor'|'color')=>{
  const el=$(scene,selector);
  if(!el) throw Error(scene+' missing '+selector);
  return getComputedStyle(el)[property];
 };
 const sceneHas=(scene:string,selector:string)=>!!$(scene,selector);
 const nativeSvgReplaced=(scene:string,selector:string)=>{
   const button=$(scene,selector);
   const svg=button?.querySelector('svg');
   return !!button && !!svg && getComputedStyle(svg).display==='none' && getComputedStyle(button).pointerEvents!=='none';
 };
 const nativeLightningVisible=(scene:string)=>{
  const button=$(scene,'.sully-chat-trigger:not([title="停止生成"])');
  const svg=button?.querySelector('svg');
  return !!svg&&getComputedStyle(svg).display!=='none'&&getComputedStyle(button!,'::after').display==='none';
 };
 const stopButton=$('silent-letter-stop','.sully-chat-trigger[title="停止生成"]');
 const stoppedIcon=stopButton?.querySelector('svg');
 const phone=$('conversation','.sully-chat-header button[aria-label="电话"]');
 const lightning=$('conversation','.sully-chat-trigger');
 const actionRowNoOverlap=!!phone&&!!lightning&&phone.getBoundingClientRect().right<=lightning.getBoundingClientRect().left+1;
 const noButtonOverlap=(scene:string,selectors:string[])=>{
  const boxes=selectors.map(s=>$(scene,s)?.getBoundingClientRect());
  return boxes.every(Boolean)&&boxes.every((a,i)=>boxes.slice(i+1).every(b=>!a||!b||a.right<=b.left+1));
 };
 const artReplacesSvg=(scene:string,selector:string,filename:string)=>{
  const btn=$(scene,selector);const svg=btn?.querySelector('svg');
  return !!btn&&!!svg&&getComputedStyle(svg).display==='none'&&getComputedStyle(btn).backgroundImage.includes(filename);
 };
 const checks={
  presetParts:['layout','bubbles','psyche','css'].every(key=>key in preset.parts),
  userBubble:color('conversation','.sully-bubble-user','backgroundColor')==='rgb(26, 26, 26)',
  partnerBubble:color('conversation','.sully-bubble-ai','backgroundColor')==='rgb(238, 238, 238)',
  groupPartnerBubble:color('group-chat','.sully-bubble-ai','backgroundColor')==='rgb(238, 238, 238)',
  profileGlass:color('conversation','.sully-chat-profile','backgroundColor')==='rgba(255, 255, 255, 0.75)',
  headerStatusSingleLine:($('conversation','.sully-chat-profile .sully-chat-status')?.getBoundingClientRect().height||100)<=20,
  transferCardFullSize:($('transfer','.sully-chat-transfer-card')?.getBoundingClientRect().width||0)>=218,
  originalNamePlate:getComputedStyle($('conversation','.sully-chat-message-group-first .sully-bubble-ai')!,'::before').content.includes('char'),
  originalInputPrompt:getComputedStyle($('conversation','.sully-chat-input-wrap')!,'::after').content.includes('imonly temporary 2 u'),
  avatarOnlyWhenVisible:[...root.querySelectorAll<HTMLElement>('[data-scene="conversation"] .sully-chat-message-avatar:not(.sully-chat-avatar-wrap)')].every(node=>{
    const hasImage=!!node.querySelector('.sully-chat-message-avatar-img');
    return hasImage || (getComputedStyle(node,'::after').content==='none' || getComputedStyle(node,'::after').content==='normal') && getComputedStyle(node).borderTopWidth==='0px';
  }),
  groupedAvatar:[...root.querySelectorAll<HTMLElement>('[data-scene="conversation"] .sully-chat-message-ai:not(.sully-chat-message-group-last) .sully-chat-message-avatar-slot')].every(slot=>!slot.querySelector('.sully-chat-avatar-wrap')),
  persistedV2BackFixed:nativeSvgReplaced('installed-v2','.sully-chat-back'),
  persistedV2PlusFixed:nativeSvgReplaced('installed-v2','.sully-chat-actions-button'),
  persistedV2LightningFixed:nativeLightningVisible('installed-v2'),
  persistedV2SendFixed:nativeSvgReplaced('installed-v2','.sully-chat-send-button'),
  oldBackIconReplaced:nativeSvgReplaced('conversation','.sully-chat-back'),
  oldPlusIconReplaced:nativeSvgReplaced('conversation','.sully-chat-actions-button'),
  headerLightningNativeVisible:nativeLightningVisible('conversation'),
  oldGenerateIconReplaced:nativeSvgReplaced('conversation','.sully-chat-send-button'),
  oldSendIconReplaced:nativeSvgReplaced('silent-letter-send','.sully-chat-send-button[aria-label="发送文字"]'),
  stopControlPreserved:!!stopButton&&!!stoppedIcon&&getComputedStyle(stoppedIcon).display!=='none'&&getComputedStyle(stopButton,'::after').display==='none',
  headerActionsNotOverlapping:actionRowNoOverlap,
  silentPhoneArt:artReplacesSvg('conversation','.sully-chat-header button[aria-label="电话"]','H9Q5nB122'),
  silentStickerArt:artReplacesSvg('conversation','.sully-chat-input-wrap button[aria-label="表情面板"]','DHYhIUp'),
  silentMicrophoneArt:artReplacesSvg('conversation','.sully-chat-input-wrap .sully-chat-voice-trigger','DcdDRsw'),
  originalSendArt:artReplacesSvg('conversation','.sully-chat-send-button','n9OXMPV'),
  disabledAINotGray:parseFloat(getComputedStyle($('conversation','.sully-chat-send-button')!).opacity)>=.8,
  inputIconsNotOverlapping:noButtonOverlap('conversation',['.sully-chat-actions-button','.sully-chat-input-wrap button[aria-label="表情面板"]','.sully-chat-voice-trigger','.sully-chat-send-button']),
  narrowInputIconsNotOverlapping:noButtonOverlap('silent-letter-narrow',['.sully-chat-actions-button','.sully-chat-input-wrap button[aria-label="表情面板"]','.sully-chat-voice-trigger','.sully-chat-send-button']),
  narrowHeaderNotOverlapping:noButtonOverlap('silent-letter-narrow',['.sully-chat-back','.sully-chat-profile','button[aria-label="电话"]','.sully-chat-trigger']),
  header:sceneHas('conversation','.sully-chat-header'),
  input:sceneHas('conversation','.sully-chat-inputbar'),
  reply:sceneHas('reply','.sully-chat-reply'),
  replyContrast:color('reply','.sully-bubble-user .sully-chat-reply','color')==='rgb(142, 142, 142)',
  replyDetached:(()=>{const quote=$('reply','.sully-bubble-user > .sully-chat-reply');const bubble=quote?.parentElement;return !!quote&&!!bubble&&quote.getBoundingClientRect().bottom<=bubble.getBoundingClientRect().top-2;})(),
  voice:sceneHas('voice-playing','.sully-voice-bar'),
  transfer:sceneHas('transfer','.sully-chat-transfer-card[data-status="pending"]'),
  accepted:sceneHas('transfer-accepted','.sully-chat-transfer-receipt'),
  returned:sceneHas('transfer-returned','.sully-chat-transfer-receipt'),
  psyche:sceneHas('psyche-open','.sully-psyche-card'),
  psycheRealCharacter:sceneHas('psyche-open','.sully-psyche-author-avatar')&&
    $('psyche-open','.sully-psyche-author-name')?.textContent==='示例角色'&&
    getComputedStyle($('psyche-open','.sully-psyche-author')!).display==='flex',
  simulatedCardStack:getComputedStyle($('sim_card','.sully-chat-card[data-card-kind="sim_card"]')!,'::before').content!=='none'&&
    getComputedStyle($('sim_card','.sully-chat-card[data-card-kind="sim_card"]')!,'::after').content!=='none',
  groupMessage:sceneHas('group-chat','.sully-chat-message-sender')&&sceneHas('group-chat','.sully-bubble-ai'),
  groupHeaderHelpArt:artReplacesSvg('group-chat','button[aria-label="群聊记忆规则"]','prPUomz7'),
  groupHeaderButtonsClear:noButtonOverlap('group-chat',['.sully-chat-back','.sully-chat-profile','button[aria-label="群聊记忆规则"]','.sully-chat-trigger']),
  groupReply:sceneHas('group-chat','.sully-chat-reply'),
  groupPacket:sceneHas('group-chat','.sully-chat-group-packet'),
  groupReceipt:sceneHas('group-chat','.sully-chat-group-packet-receipt'),
  safeControls:sceneHas('conversation','.sully-chat-send-button') || sceneHas('conversation','.sully-chat-actions-button'),
  noOverflow:![...root.querySelectorAll<HTMLElement>('.scene')].some(el=>el.scrollWidth>el.clientWidth+2),
 };
 root.dataset.ready=Object.values(checks).every(Boolean)?'true':'false';
 const output=document.createElement('output');output.id='silent-letter-checks';output.textContent=JSON.stringify(checks);root.prepend(output);
 if(root.dataset.ready==='false') {
  const node=$('conversation','.sully-chat-message-group-first .sully-bubble-ai');
  const markerCss=node?getComputedStyle(node,'::before').content:'no bubble';
  const card=node?.closest('.sully-chat-card');
  const transferNode=$('transfer','.sully-chat-transfer-card');const transferParent=transferNode?.closest('.sully-chat-message-content');
  const errorDetails={markerCss,cardKind:card?.getAttribute('data-card-kind'),messageClass:node?.closest('.sully-chat-message')?.className,transferWidth:transferNode?.getBoundingClientRect().width,parentWidth:transferParent?.getBoundingClientRect().width,parentMaxWidth:transferParent?getComputedStyle(transferParent).maxWidth:'',cardWidth:transferNode?.closest('.sully-chat-card')?.getBoundingClientRect().width,surfaceWidth:transferNode?.closest('.sully-chat-card-surface')?.getBoundingClientRect().width,contentWidth:transferNode?.closest('.sully-chat-card-content')?.getBoundingClientRect().width,cardComputedWidth:transferNode?getComputedStyle(transferNode).width:'',cardComputedMax:transferNode?getComputedStyle(transferNode).maxWidth:'',closestCard:card?.outerHTML.slice(0,260),bubbleHtml:node?.outerHTML.slice(0,220)};
  const debug=document.createElement('output');debug.id='silent-letter-debug';debug.textContent=JSON.stringify(errorDetails);root.prepend(debug);
  throw Error('Visual assertions failed: '+JSON.stringify(checks));
 }
} catch(error) {
 root.dataset.ready='false';root.dataset.error=String(error);
 const output=document.createElement('output');output.id='silent-letter-error';output.textContent=String(error);root.prepend(output);
}