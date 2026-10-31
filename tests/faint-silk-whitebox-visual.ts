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
 // Simulate the former installed Faint Silk CSS with its fixed ::after background.
 // The live avatar must replace it without requiring users to reapply the outfit.
 const legacy=structuredClone(preset);
 legacy.parts.css += '\n.sully-chat-root:not(.sully-chat-group-root) .sully-chat-header:has(.sully-chat-back.absolute) .sully-chat-name::after{content:"";position:absolute;left:calc(50% + 5px);top:-56px;width:50px;height:50px;background:url("https://i.postimg.cc/DycRKBL9/image.jpg") center/cover no-repeat!important;}';
 // Emulate imported previous-version sticker rules too, not just the avatar photo.
 legacy.parts.css += '\n.sully-chat-back{background-image:url("https://i.postimg.cc/x1x7X8xD/image.png")!important}.sully-chat-back > svg{visibility:hidden!important}.sully-chat-trigger:not([title="停止生成"]){background-image:url("https://i.postimg.cc/0y2F5DCz/image.png")!important}.sully-chat-trigger:not([title="停止生成"]) > svg{visibility:hidden!important}.sully-chat-actions-button{background-image:url("https://i.postimg.cc/qMGWdjyD/image.png")!important}.sully-chat-actions-button > svg{visibility:hidden!important}.sully-chat-input-wrap button[aria-label="表情面板"]{background-image:url("https://i.postimg.cc/rwnbDsnc/image.png")!important}.sully-chat-input-wrap button[aria-label="表情面板"] > svg{visibility:hidden!important}';
 const oldScene=renderChatDecorationSample(legacy,'conversation');
 const legacySection=document.createElement('section');legacySection.className='scene';legacySection.dataset.scene='legacy-pair';
 legacySection.innerHTML='<div class="beauty-preview-body">'+oldScene.markup+'</div>';
 const legacyStyle=document.createElement('style');legacyStyle.textContent=oldScene.css;legacySection.prepend(legacyStyle);
 const legacyLabel=document.createElement('h2');legacyLabel.textContent='已应用旧浅丝 / 自动兼容';legacySection.prepend(legacyLabel);
 root.append(legacySection);
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
 // Image elements can be present before their bytes decode; use the rendered image for assertions.
 await Promise.all([...root.querySelectorAll<HTMLImageElement>('.sully-chat-avatar-pair img')]
   .map(img=>img.decode().catch(()=>{})));
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
  oldSavedThemeReplaced:!!$('legacy-pair','.sully-chat-pair-user-avatar')
    && ['none','normal'].includes(getComputedStyle($('legacy-pair','.sully-chat-name')!,'::after').content),
  userGlass:style('conversation','.sully-bubble-user').backgroundColor==='rgba(255, 255, 255, 0.61)',
  aiGlass:style('conversation','.sully-bubble-ai').backgroundColor==='rgba(255, 255, 255, 0.61)',
  groupGlass:style('group-chat','.sully-bubble-ai').backgroundColor==='rgba(255, 255, 255, 0.61)',
  groupPacket:!!$('group-chat','.sully-chat-group-packet'),
  groupReceipt:!!$('group-chat','.sully-chat-group-packet-receipt'),
  transferGlass:style('transfer','.sully-chat-transfer-card').backgroundColor==='rgba(255, 255, 255, 0.61)',
  transferReceipt:!!$('transfer-accepted','.sully-chat-transfer-receipt')||!!$('transfer-returned','.sully-chat-transfer-receipt'),
  // Compare rendered controls rather than source text: sticker backgrounds must disappear,
  // native buttons must remain visible and be compact on 360px mobile layout.
  cleanBackIcon:style('conversation','.sully-chat-back').backgroundImage==='none'
    && style('conversation','.sully-chat-back > svg').visibility==='visible',
  cleanTriggerIcon:style('conversation','.sully-chat-trigger').backgroundImage==='none'
    && style('conversation','.sully-chat-trigger > svg').visibility==='visible',
  cleanActionsIcon:style('conversation','.sully-chat-actions-button').backgroundImage==='none'
    && style('conversation','.sully-chat-actions-button > svg').visibility==='visible',
  cleanEmojiIcon:style('conversation','.sully-chat-input-wrap button[aria-label="表情面板"]').backgroundImage==='none'
    && style('conversation','.sully-chat-input-wrap button[aria-label="表情面板"] > svg').visibility==='visible',
  oldSavedIconsReset:style('legacy-pair','.sully-chat-back').backgroundImage==='none'
    && style('legacy-pair','.sully-chat-back > svg').visibility==='visible'
    && style('legacy-pair','.sully-chat-actions-button > svg').visibility==='visible'
    && style('legacy-pair','.sully-chat-trigger').backgroundImage==='none'
    && style('legacy-pair','.sully-chat-input-wrap button[aria-label="表情面板"]').backgroundImage==='none',
  badgeDoesNotCoverPair:(()=>{
    const pair=$('conversation','.sully-chat-avatar-pair')?.getBoundingClientRect();
    const badge=$('conversation','.sully-chat-floating-status .sully-chat-token')?.getBoundingClientRect();
    return !!pair&&!!badge&&(badge.left>=pair.right+5||badge.right<=pair.left-5);
  })(),
  phoneFits: (()=>{
    const phone=$('conversation','.sully-chat-header button[aria-label="电话"]')?.getBoundingClientRect();
    const ai=$('conversation','.sully-chat-trigger')?.getBoundingClientRect();
    return !!phone&&!!ai&&phone.right+3<=ai.left&&phone.width>=36&&phone.height>=36;
  })(),
  composerFit:(()=>{
    const composer=$('conversation','.sully-chat-composer')?.getBoundingClientRect();
    const actions=$('conversation','.sully-chat-actions-button')?.getBoundingClientRect();
    const input=$('conversation','.sully-chat-input-wrap')?.getBoundingClientRect();
    const send=$('conversation','.sully-chat-send-button')?.getBoundingClientRect();
    return !!composer&&!!actions&&!!input&&!!send
      && actions.right+3<=input.left&&input.right+3<=send.left
      && input.width>=175&&send.right<=composer.right+2;
  })(),
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
