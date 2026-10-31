/** Screenshot smoke: native Chat Header, MessageItem and GroupChat renderers, fictional data. */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {renderChatDecorationSample} from '../components/chat/ChatDecorationSample';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {GroupMessageItem,GroupPacketCard} from '../apps/GroupChat';
import MessageItem from '../components/chat/MessageItem';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';
const root=document.querySelector<HTMLElement>('#friend-rain-visual');
if(!root)throw Error('No host');
try {
 const preset=BUILTIN_WHITEBOX_PRESETS.find(item=>item.id==='builtin-friend-request-rain')?.read();
 if(!preset)throw Error('Friend Rain not found');
 for(const scene of ['conversation','silent-letter-send','silent-letter-stop','reply','psyche','psyche-open','voice-playing','transfer','transfer-accepted','transfer-returned']){
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

 // Translation exercise uses the real MessageItem and the actual %%BILINGUAL%% contract.
 // The legacy preview text placed its marker first and produced an empty message.
 const translation=document.createElement('section');
 translation.className='scene';translation.dataset.scene='translation-real';
 const translateMarkup=renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sample-chat'},
  React.createElement('div',{className:'sully-chat-messages sample-messages'},
   React.createElement(MessageItem,{msg:{...demo,id:29901,content:'You are my serendipity%%BILINGUAL%%你是我的不期而遇'},activeTheme:preset.parts.bubbles!,charName:'示例角色',
    charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,isFirstInGroup:true,isLastInGroup:true,
    translationEnabled:true,translationExpanded:true,onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,
    onToggleSelect:()=>{},suppressEntranceAnimation:true}),
   React.createElement(MessageItem,{msg:{...demo,id:29902,content:'明天一起看海%%BILINGUAL%%See the sea tomorrow'},activeTheme:preset.parts.bubbles!,charName:'示例角色',
    charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,isFirstInGroup:true,isLastInGroup:true,
    translationEnabled:true,translationExpanded:false,onTranslateToggle:()=>{},onLongPress:()=>{},onReply:()=>{},
    selectionMode:false,isSelected:false,onToggleSelect:()=>{},suppressEntranceAnimation:true})
  )));
 translation.innerHTML='<h2>真实双语展开与翻译按钮</h2><div class="beauty-preview-body">'+translateMarkup+'</div>';
 const translationStyle=document.createElement('style');translationStyle.textContent=renderChatDecorationSample(preset,'reply').css;
 translation.prepend(translationStyle);root.append(translation);
 const $=(scene:string,selector:string)=>root.querySelector<HTMLElement>('[data-scene="'+scene+'"] '+selector);

 const rect=(scene:string,sel:string)=>$(scene,sel)?.getBoundingClientRect();
 const overlap=(a:DOMRect|undefined,b:DOMRect|undefined)=>!!a&&!!b&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
 const cssStyle=(scene:string,sel:string,pseudo?:string)=>{const el=$(scene,sel);if(!el)throw Error('missing '+scene+' '+sel);return getComputedStyle(el,pseudo)};

 // Responsive layout is measured with real browser boxes, not guessed CSS strings.
 const responsiveDiagnostics:Array<Record<string,unknown>>=[];
 const responsive=[320,360,390,430].every(width=>{
  const section=root.querySelector<HTMLElement>('[data-scene="conversation"]');
  const body=section?.querySelector<HTMLElement>('.beauty-preview-body');
  const app=section?.querySelector<HTMLElement>('.sample-chat');
  if(!section||!body||!app)return false;
  const prior=[section.style.width,body.style.width,app.style.width];
  section.style.width=width+'px';body.style.setProperty('width',width+'px','important');app.style.width=width+'px';
  const grab=(s:string)=>app.querySelector<HTMLElement>(s);
  const R=(s:string)=>grab(s)?.getBoundingClientRect();
  const back=R('.sully-chat-back'),profile=R('.sully-chat-profile'),lightning=R('.sully-chat-trigger');
  const plus=R('.sully-chat-actions-button'),mic=R('.sully-chat-voice-trigger');
  const face=R('.sully-chat-input-wrap button[aria-label="表情面板"]'),send=R('.sully-chat-send-button');
  const textarea=R('.sully-chat-textarea'),composer=R('.sully-chat-composer');
  const good=!!back&&!!profile&&!!lightning&&!!plus&&!!mic&&!!face&&!!send&&!!textarea&&!!composer
   && !overlap(back,profile)&&!overlap(profile,lightning)
   && !overlap(mic,face)&&!overlap(face,send)
   && !overlap(plus,textarea)&&textarea.width>=90
   && mic.left>=composer.left&&send.right<=composer.right+2
   && plus.left>=composer.left;
  responsiveDiagnostics.push({width,good,
   back:back&&[back.left,back.right],profile:profile&&[profile.left,profile.right],
   lightning:lightning&&[lightning.left,lightning.right],plus:plus&&[plus.left,plus.right],
   mic:mic&&[mic.left,mic.right],face:face&&[face.left,face.right],
   send:send&&[send.left,send.right],textarea:textarea&&[textarea.left,textarea.right],
   composer:composer&&[composer.left,composer.right]});
  section.style.width=prior[0];body.style.width=prior[1];app.style.width=prior[2];
  return good;
 });

 const checks={
  responsive,
  headerTaller:(rect('conversation','.sully-chat-header')?.height||0)>=135,
  footerCompact:(rect('conversation','.sully-chat-inputbar')?.height||0)<=96,
  requestLabelsClearOfProfile:(()=>{
    const header=rect('conversation','.sully-chat-header');
    const profile=rect('conversation','.sully-chat-profile');
    return !!header&&!!profile&&profile.right<=header.right-92;
  })(),
  nativePrivate:!!$('conversation','.sully-chat-header')&&!!$('conversation','.sully-chat-composer'),
  nativeGroup:!!$('group','.sully-bubble-ai')&&!!$('group','.sully-bubble-user'),
  groupPacket:!!$('group','.sully-chat-group-packet'),
  groupReceipt:!!$('group','.sully-chat-group-packet-receipt'),
  transfer:cssStyle('transfer','.sully-chat-transfer-card').backgroundImage.includes('gradient'),
  accepted:!!$('transfer-accepted','.sully-chat-transfer-receipt'),
  returned:!!$('transfer-returned','.sully-chat-transfer-receipt'),
  reply:!!$('reply','.sully-chat-reply'),
  voice:!!$('voice-playing','.sully-voice-bar'),
  hearts:cssStyle('conversation','.sully-bubble-user','::after').backgroundImage.includes('data:image/svg+xml'),
  avatarPolaroid:(rect('conversation','.sully-chat-profile .sully-chat-avatar')?.height||0)>=60,
  originalHeaderImage:cssStyle('conversation','.sully-chat-header').backgroundImage.includes('73e0368b5bd87713b3c6506c4989f43a.jpeg'),
  darkFloatingPill:cssStyle('conversation','.sully-chat-composer','::before').backgroundColor==='rgb(37, 37, 37)',
  bilingualFooter:cssStyle('conversation','.sully-chat-inputbar','::before').content.includes('Dreamed of a rain'),
  noInventedWallpaper:cssStyle('conversation','.sully-chat-root').backgroundImage==='none',
  psyche:!!$('psyche','.sully-psyche-title')&&!!$('psyche-open','.sully-psyche-body'),
  translated:!!$('translation-real','.sully-facebook-translation')
    && !!$('translation-real','.sully-chat-translate-action button')
    && cssStyle('translation-real','.sully-chat-translate-action button','::after').backgroundImage.includes('data:image/svg+xml'),
  blackBubble:cssStyle('conversation','.sully-bubble-user').backgroundColor==='rgb(0, 0, 0)',
  whiteBubble:cssStyle('conversation','.sully-bubble-ai').backgroundColor==='rgb(255, 255, 255)',
  nativeBackVisible:cssStyle('conversation','.sully-chat-back > svg').display!=='none'
   && cssStyle('conversation','.sully-chat-back > svg').opacity==='1',
  sourcePlusReplacesNative:cssStyle('conversation','.sully-chat-actions-button > svg').display==='none'
   && cssStyle('conversation','.sully-chat-actions-button','::after').backgroundImage.includes('data:image/svg+xml'),
  mergedPhoneButton:cssStyle('conversation','.sully-chat-header button[aria-label="电话"]','::after').content.includes('拒绝')
    && cssStyle('conversation','.sully-chat-header button[aria-label="电话"] > svg').display==='none',
  mergedGenerateButton:cssStyle('conversation','.sully-chat-trigger','::after').content.includes('同意')
    && cssStyle('conversation','.sully-chat-trigger > svg').display==='none',
  mergedStopButton:cssStyle('silent-letter-stop','.sully-chat-trigger','::after').content.includes('停止'),
  noDuplicatedHeaderLabels:cssStyle('conversation','.sully-chat-header','::after').content==='none'
    && cssStyle('conversation','.sully-chat-header','::before').content==='none',
  userFiveHearts:cssStyle('conversation','.sully-chat-message-user.sully-chat-message-group-first .sully-chat-message-content','::before').backgroundImage.split('data:image/svg+xml').length===6,
  aiFiveHearts:cssStyle('conversation','.sully-chat-message-ai.sully-chat-message-group-first .sully-chat-message-content','::before').backgroundImage.split('data:image/svg+xml').length===6,
  userReadReceipt:cssStyle('conversation','.sully-chat-message-user .sully-chat-message-timestamp','::after').content.includes('已读'),
  stopAvailable:!!$('silent-letter-stop','.sully-chat-trigger[title="停止生成"]'),
  sendAvailable:!!$('silent-letter-send','.sully-chat-send-button'),
  headerSeparated:!overlap(rect('conversation','.sully-chat-back'),rect('conversation','.sully-chat-trigger')),
  composerSeparated:!overlap(rect('conversation','.sully-chat-actions-button'),rect('conversation','.sully-chat-input-wrap'))
    &&!overlap(rect('conversation','.sully-chat-voice-trigger'),rect('conversation','.sully-chat-input-wrap button[aria-label="表情面板"]'))
    &&!overlap(rect('conversation','.sully-chat-input-wrap button[aria-label="表情面板"]'),rect('conversation','.sully-chat-send-button')),
  mic:!!$('conversation','.sully-chat-voice-trigger')
    && cssStyle('conversation','.sully-chat-voice-trigger','::after').backgroundImage.includes('data:image/svg+xml'),
  composerReadable:(rect('conversation','.sully-chat-input-wrap')?.width||0)>=115,
  clickIntact:['.sully-chat-back','.sully-chat-trigger','.sully-chat-actions-button','.sully-chat-send-button'].every(s=>cssStyle('conversation',s).pointerEvents!=='none'),
  transferInteractive:cssStyle('transfer','.sully-chat-transfer-card').pointerEvents!=='none',
  transferDecorated:cssStyle('transfer','.sully-chat-transfer-card .sully-chat-transfer-watermark').display==='none'
    && cssStyle('transfer','.sully-chat-transfer-card .sully-chat-transfer-icon').backgroundImage.includes('IMG-3703.png')
    && cssStyle('transfer','.sully-chat-transfer-card .sully-chat-transfer-icon > svg').display==='none',
  headerPictureRoom:(rect('conversation','.sully-chat-header')?.height||0)>=82,
  noOverflow:[...root.querySelectorAll<HTMLElement>('.scene')].every(e=>e.scrollWidth<=e.clientWidth+2)
 };
 root.dataset.ready=Object.values(checks).every(Boolean)?'true':'false';
 const output=document.createElement('output');output.textContent=JSON.stringify(checks,null,2);root.prepend(output);
 if(root.dataset.ready!=='true')throw Error(JSON.stringify({checks,responsiveDiagnostics}));
}catch(e){root.dataset.ready='false';root.dataset.error=String(e);const output=document.createElement('output');output.textContent=String(e);root.prepend(output)}
