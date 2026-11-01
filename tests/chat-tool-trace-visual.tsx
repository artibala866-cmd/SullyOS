/** Real mounted React layout across every bundled whitebox and compact bubble mode. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import MessageItem from '../components/chat/MessageItem';
import ChatToolTrace from '../components/chat/ChatToolTrace';
import {BUILTIN_WHITEBOX_PRESETS} from '../utils/builtinWhitebox';
import {PRESET_THEMES} from '../components/chat/ChatConstants';
import {QQ_BUBBLE_CSS} from '../utils/qqBubbleTheme';
import {WECHAT_BUBBLE_CSS} from '../utils/wechatBubbleTheme';
import {BLACK_WHITE_FACEBOOK_CSS} from '../utils/blackWhiteFacebookTheme';
import {BEAUTY_PREVIEW_AVATAR} from '../utils/beautyPreviewAssets';

const stage=document.querySelector<HTMLElement>('#stage');
const output=document.querySelector<HTMLOutputElement>('#results');
if(!stage||!output)throw Error('Missing test stage');
const mount=createRoot(stage);
const presets=[
 ...BUILTIN_WHITEBOX_PRESETS.map(p=>{const outfit=p.read();return {name:p.id,css:outfit.parts.css||'',bubble:outfit.parts.bubbles||PRESET_THEMES.default,classes:'',flags:{}}}),
 {name:'bubble-qq',css:QQ_BUBBLE_CSS,bubble:PRESET_THEMES.forest,classes:'sully-chat-qq',flags:{qqBubble:true}},
 {name:'bubble-wechat',css:WECHAT_BUBBLE_CSS,bubble:PRESET_THEMES.dream,classes:'sully-chat-wechat',flags:{wechatBubble:true}},
 {name:'bubble-monochrome',css:BLACK_WHITE_FACEBOOK_CSS,bubble:PRESET_THEMES.default,classes:'sully-chat-monochrome',flags:{blackWhiteFacebook:true}},
];
const themeStyle=document.createElement('style');
document.head.append(themeStyle);
const demo=(id:number,content:string,timestamp:number)=>({id,role:'assistant' as const,type:'text' as const,charId:'preview',timestamp,content});
const common={charName:'示例角色',charAvatar:BEAUTY_PREVIEW_AVATAR,userAvatar:BEAUTY_PREVIEW_AVATAR,
 onLongPress:()=>{},onReply:()=>{},selectionMode:false,isSelected:false,onToggleSelect:()=>{},
 avatarShape:'circle' as const,avatarSize:'small' as const,avatarMode:'grouped' as const,
 bubbleVariant:'modern' as const,showTimestamp:'always' as const,suppressEntranceAnimation:true};
const run=()=>{
 const records:Array<Record<string,unknown>>=[];
 for(const preset of presets)for(const width of [320,360,390,430]){
  themeStyle.textContent=preset.css;
  stage.style.width=width+'px';
  const first=demo(1001,'嗯',Date.now()-2000000);
  const second=demo(1002,'知道了，我们继续。',Date.now());
  flushSync(()=>mount.render(React.createElement('main',{className:'sully-chat-root sample-chat '+preset.classes,style:{width:'100%',minHeight:320,paddingTop:12,background:'transparent'}},
   React.createElement('div',{className:'sully-chat-messages',style:{width:'100%',minWidth:0,overflow:'visible'}},
    React.createElement('div',{'data-row':'trace'},
     React.createElement(MessageItem,{...common,...preset.flags,msg:first,activeTheme:preset.bubble,
      friendRainWhitebox:preset.name==='builtin-friend-request-rain',isFirstInGroup:true,isLastInGroup:true}),
     React.createElement(ChatToolTrace,{text:'搜索网页 · 读取记忆 ×2 · get_weather · 读取小红书 ×3'})),
    React.createElement('div',{'data-row':'next'},
     React.createElement(MessageItem,{...common,...preset.flags,msg:second,activeTheme:preset.bubble,
      friendRainWhitebox:preset.name==='builtin-friend-request-rain',isFirstInGroup:true,isLastInGroup:true}))
   ))));
  const select=(selector:string)=>stage.querySelector<HTMLElement>(selector);
  const bubble=select('[data-row="trace"] .sully-bubble-ai');
  const anchor=select('[data-row="trace"] .sully-chat-message-content');
  const stamp=select('[data-row="trace"] .sully-chat-message-timestamp');
  const hint=select('[data-row="trace"] [data-tool-trace-text]');
  const next=select('[data-row="next"] .sully-bubble-ai');
  if(!bubble||!anchor||!hint||!next)throw Error('Missing real message '+preset.name+' '+width);
  const b=bubble.getBoundingClientRect(),a=anchor.getBoundingClientRect();
  const h=hint.getBoundingClientRect(),n=next.getBoundingClientRect();
  const t=stamp?.getBoundingClientRect();
  const ok=h.top>=b.bottom+1&&(t==null||h.top>=t.bottom+1)
   &&h.bottom<=n.top-1&&Math.abs(h.left-a.left)<=3
   &&h.right<=stage.getBoundingClientRect().right+2
   &&stage.scrollWidth<=stage.clientWidth+2;
  records.push({theme:preset.name,width,ok,bottom:b.bottom,stampBottom:t?.bottom,hintTop:h.top,hintBottom:h.bottom,nextTop:n.top,leftDiff:Math.round(h.left-a.left)});
 }
 const failed=records.filter(x=>!x.ok);
 output.textContent=JSON.stringify({checked:records.length,failed,records},null,2);
 document.documentElement.dataset.ready=failed.length===0?'true':'false';
 if(failed.length)throw Error('Tool hints overlap under '+failed.length+' theme/width combinations');
};
try{run()}catch(error){document.documentElement.dataset.ready='false';document.documentElement.dataset.error=String(error);output.textContent+='\n'+String(error)}
