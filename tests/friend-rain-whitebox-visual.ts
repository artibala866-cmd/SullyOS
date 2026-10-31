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

 // Native two-message turn: verify the actual avatar image is rendered only for the first message.
 const avatarScene=document.createElement('section');avatarScene.className='scene';avatarScene.dataset.scene='avatar-group';
 const avatarMarkup=renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sample-chat'},
   React.createElement('div',{className:'sully-chat-messages sample-messages'},
     React.createElement(MessageItem,{msg:{...demo,id:30001,role:'assistant',content:'第一条'},activeTheme:preset.parts.bubbles!,
      charName:'示例角色',charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,isFirstInGroup:true,isLastInGroup:false,
      friendRainWhitebox:true,avatarMode:'grouped',avatarSize:'small',onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},suppressEntranceAnimation:true}),
     React.createElement(MessageItem,{msg:{...demo,id:30002,role:'assistant',content:'第二条'},activeTheme:preset.parts.bubbles!,
      charName:'示例角色',charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,isFirstInGroup:false,isLastInGroup:true,
      friendRainWhitebox:true,avatarMode:'grouped',avatarSize:'small',onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},suppressEntranceAnimation:true})
  )));
 avatarScene.innerHTML='<h2>头像首条 / 连发不重复</h2><div class="beauty-preview-body">'+avatarMarkup+'</div>';
 const avatarStyle=document.createElement('style');avatarStyle.textContent=renderChatDecorationSample(preset,'conversation').css;
 avatarScene.prepend(avatarStyle);root.append(avatarScene);

 // Regression: short first messages must never gain a displaced bubble when hearts are shown.
 const heartScene=document.createElement('section');
 heartScene.className='scene';heartScene.dataset.scene='heart-alignment';
 const heartMessages=[
  {id:40101,role:'assistant' as const,first:true,last:false},
  {id:40102,role:'assistant' as const,first:false,last:true},
  {id:40103,role:'user' as const,first:true,last:false},
  {id:40104,role:'user' as const,first:false,last:true},
 ];
 const heartMarkup=renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sample-chat'},
  React.createElement('div',{className:'sully-chat-messages sample-messages'},
    ...heartMessages.map(item=>React.createElement(MessageItem,{
      msg:{...demo,id:item.id,role:item.role,content:'嗯'},
      activeTheme:preset.parts.bubbles!,friendRainWhitebox:true,
      charName:'示例角色',charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,
      isFirstInGroup:item.first,isLastInGroup:item.last,
      avatarMode:'grouped',avatarSize:'small',showTimestamp:'never',
      onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},
      suppressEntranceAnimation:true,
    }))
  )));
 heartScene.innerHTML='<h2>五心与短气泡对齐（双方首条/后续）</h2><div class="beauty-preview-body">'+heartMarkup+'</div>';
 const heartStyle=document.createElement('style');heartStyle.textContent=renderChatDecorationSample(preset,'conversation').css;
 heartScene.prepend(heartStyle);root.append(heartScene);

 // Regression: tiny text bubbles with detached quotes should remain readable
 // and leave independent space for native timestamp/read status.
 const quoteScene=document.createElement('section');quoteScene.className='scene';quoteScene.dataset.scene='quote-compact';
 const replySample={name:'示例角色',content:'一段比较长的引用：保持它在气泡外显示，不要被时间或下一条消息遮挡'};
 const quoteItems=[
  {id:40501,role:'assistant' as const,first:true,last:true,reply:true},
  {id:40502,role:'assistant' as const,first:true,last:true,reply:false},
  {id:40503,role:'user' as const,first:true,last:true,reply:true},
  {id:40504,role:'user' as const,first:true,last:true,reply:false},
 ];
 const quoteMarkup=renderToStaticMarkup(React.createElement('main',{className:'sully-chat-root sample-chat'},
  React.createElement('div',{className:'sully-chat-messages sample-messages'},
   ...quoteItems.map(item=>React.createElement(MessageItem,{
     msg:{...demo,id:item.id,role:item.role,content:'嗯',replyTo:item.reply?replySample:undefined},
     activeTheme:preset.parts.bubbles!,friendRainWhitebox:true,
     charName:'示例角色',charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,
     isFirstInGroup:item.first,isLastInGroup:item.last,showTimestamp:'always',
     avatarMode:'grouped',avatarSize:'small',
     onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,
     onToggleSelect:()=>{},suppressEntranceAnimation:true
   }))
  )));
 quoteScene.innerHTML='<h2>缩小气泡与独立引用不遮挡</h2><div class="beauty-preview-body">'+quoteMarkup+'</div>';
 const quoteStyle=document.createElement('style');quoteStyle.textContent=renderChatDecorationSample(preset,'conversation').css;
 quoteScene.prepend(quoteStyle);root.append(quoteScene);
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


 // Compare the *bubble rectangles* (not the decorative SVG) at actual mobile widths.
 const heartAlignment=[320,360,390,430].every(width=>{
  const body=heartScene.querySelector<HTMLElement>('.beauty-preview-body');
  const app=heartScene.querySelector<HTMLElement>('.sample-chat');
  if(!body||!app)return false;
  const oldBody=body.style.width,oldApp=app.style.width;
  body.style.setProperty('width',width+'px','important');app.style.width=width+'px';
  const bubbles=[...app.querySelectorAll<HTMLElement>('.sully-bubble-ai,.sully-bubble-user')];
  const ai=bubbles.filter(e=>e.classList.contains('sully-bubble-ai'));
  const me=bubbles.filter(e=>e.classList.contains('sully-bubble-user'));
  const pairAligned=(pair:HTMLElement[],edge:'left'|'right')=>pair.length===2
    &&Math.abs(pair[0].getBoundingClientRect()[edge]-pair[1].getBoundingClientRect()[edge])<=1
    &&Math.abs(pair[0].getBoundingClientRect().width-pair[1].getBoundingClientRect().width)<=1;
  const firstHearts=!!ai[0]&&!!me[0]
    &&[ai[0],me[0]].every(el=>{
      const style=getComputedStyle(el,'::after');
      return style.position==='absolute'&&style.display!=='none'
        &&style.backgroundImage.split('data:image/svg+xml').length===6
        &&getComputedStyle(el).marginTop==='0px';
    });
  const oldHearts=[...app.querySelectorAll<HTMLElement>('.sully-chat-message-group-first .sully-chat-message-content')]
    .every(el=>getComputedStyle(el,'::before').display==='none');
  const ok=pairAligned(ai,'left')&&pairAligned(me,'right')&&firstHearts&&oldHearts;
  body.style.width=oldBody;app.style.width=oldApp;
  return ok;
 });


 // Actual browser rectangles at four widths, for both user and Char.
 const quoteDiagnostics:Array<Record<string,unknown>>=[];
 const quoteCompactChecks=[320,360,390,430].every(width=>{
  const body=quoteScene.querySelector<HTMLElement>('.beauty-preview-body');
  const app=quoteScene.querySelector<HTMLElement>('.sample-chat');
  if(!body||!app)return false;
  const oldBody=body.style.width,oldApp=app.style.width;
  body.style.setProperty('width',width+'px','important');app.style.width=width+'px';
  const messages=[...app.querySelectorAll<HTMLElement>('.sully-chat-message')];
  const pairs:[[number,number],[number,number]]=[[0,1],[2,3]];
  const ok=messages.length===4&&pairs.every(([i,j])=>{
   const rootMsg=messages[i],next=messages[j];
   const bubble=rootMsg.querySelector<HTMLElement>('.sully-bubble-user,.sully-bubble-ai');
   const quote=rootMsg.querySelector<HTMLElement>('.sully-chat-reply');
   const stamp=rootMsg.querySelector<HTMLElement>('.sully-chat-message-timestamp');
   const inner=rootMsg.querySelector<HTMLElement>('.sully-facebook-bubble-text');
   const nextBubble=next.querySelector<HTMLElement>('.sully-bubble-user,.sully-bubble-ai');
   if(!bubble||!quote||!stamp||!inner||!nextBubble)return false;
   const b=bubble.getBoundingClientRect(),q=quote.getBoundingClientRect();
   const t=stamp.getBoundingClientRect(),n=nextBubble.getBoundingClientRect();
   const singleLineQuote=q.height<=24&&q.width>60;
   const quoteNoOverlap=q.top>=b.bottom+3&&t.top>=q.bottom&&n.top>=t.bottom;
   const appBounds=app.getBoundingClientRect();
   const quoteInsideScreen=q.left>=appBounds.left-1&&q.right<=appBounds.right+1;
   const compact=getComputedStyle(inner).fontSize==='12px'
     &&getComputedStyle(inner).lineHeight!=='normal'
     &&getComputedStyle(bubble).paddingLeft==='9px';
   const good=singleLineQuote&&quoteNoOverlap&&quoteInsideScreen&&compact;
   quoteDiagnostics.push({width,index:i,good,singleLineQuote,quoteNoOverlap,quoteInsideScreen,compact,
     q:[q.left,q.right,q.top,q.bottom,q.width,q.height],b:[b.top,b.bottom,b.width],
     t:[t.top,t.bottom],n:[n.top,n.bottom],font:getComputedStyle(inner).fontSize,
     quoteCss:getComputedStyle(quote).maxWidth});
   return good;
  });
  body.style.width=oldBody;app.style.width=oldApp;
  return ok;
 });

 const checks={
  quoteCompactChecks,
  heartAlignment,
  responsive,
  headerRestored:(rect('conversation','.sully-chat-header')?.height||0)>=135 && (rect('conversation','.sully-chat-header')?.height||0)<=165,
  footerRestored:(rect('conversation','.sully-chat-inputbar')?.height||0)<=96 && (rect('conversation','.sully-chat-inputbar')?.height||0)>=75,
  requestLabelsClearOfProfile:(()=>{
    const header=rect('conversation','.sully-chat-header');
    const profile=rect('conversation','.sully-chat-profile');
    return !!header&&!!profile&&profile.right<=header.right-92;
  })(),
  headerAvatarWithinProfile:(()=>{
    const a=rect('conversation','.sully-chat-profile .sully-chat-avatar');
    const p=rect('conversation','.sully-chat-profile');
    return !!a&&!!p&&a.width<=78&&a.right<=p.right+9&&a.left>=p.left-9;
  })(),
  groupAvatarFirstOnly:(()=>{
    const first=$('avatar-group','.sully-chat-message-group-first .sully-chat-message-avatar-slot img');
    const last=$('avatar-group','.sully-chat-message-group-last .sully-chat-message-avatar-slot img');
    return !!first&&!last;
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
  avatarPolaroid:(rect('conversation','.sully-chat-profile .sully-chat-avatar')?.height||0)>=60 && (rect('conversation','.sully-chat-profile .sully-chat-avatar')?.height||0)<=78,
  originalHeaderImage:cssStyle('conversation','.sully-chat-header').backgroundImage.includes('73e0368b5bd87713b3c6506c4989f43a.jpeg'),
  darkFloatingPill:cssStyle('conversation','.sully-chat-composer','::before').backgroundColor==='rgb(37, 37, 37)',
  bilingualFooter:cssStyle('conversation','.sully-chat-inputbar','::before').content.includes('Dreamed of a rain'),
  noInventedWallpaper:cssStyle('conversation','.sully-chat-root').backgroundImage==='none',
  psyche:!!$('psyche','.sully-psyche-title')&&!!$('psyche-open','.sully-psyche-body'),
  translated:!!$('translation-real','.sully-facebook-translation')
    && !!$('translation-real','.sully-chat-translate-action button')
    && cssStyle('translation-real','.sully-chat-translate-action button','::after').backgroundImage.includes('data:image/svg+xml'),
  bubbleOnlyCompact:cssStyle('conversation','.sully-bubble-user').fontSize==='12px'
    && cssStyle('conversation','.sully-bubble-ai').fontSize==='12px'
    && cssStyle('conversation','.sully-bubble-user').paddingTop==='5px'
    && cssStyle('conversation','.sully-bubble-ai').paddingLeft==='9px',
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
  userFiveHearts:cssStyle('conversation','.sully-chat-message-user.sully-chat-message-group-first .sully-bubble-user','::after').backgroundImage.split('data:image/svg+xml').length===6
    && cssStyle('conversation','.sully-chat-message-user.sully-chat-message-group-first .sully-bubble-user','::after').display!=='none',
  aiFiveHearts:cssStyle('conversation','.sully-chat-message-ai.sully-chat-message-group-first .sully-bubble-ai','::after').backgroundImage.split('data:image/svg+xml').length===6
    && cssStyle('conversation','.sully-chat-message-ai.sully-chat-message-group-first .sully-bubble-ai','::after').display!=='none',
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
 if(root.dataset.ready!=='true')throw Error(JSON.stringify({checks,responsiveDiagnostics,quoteDiagnostics}));
}catch(e){root.dataset.ready='false';root.dataset.error=String(e);const output=document.createElement('output');output.textContent=String(e);root.prepend(output)}
