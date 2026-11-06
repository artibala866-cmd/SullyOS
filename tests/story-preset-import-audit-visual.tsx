import React from 'react';
import {createRoot} from 'react-dom/client';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import {STORY_THEME_CSS} from '../components/date/story/StoryTheaterTheme';
import {BUILTIN_NIGHT_SCREENING_PRESET,parseStoryTheaterPreset} from '../utils/storyTheater';
const q=new URLSearchParams(location.search);
const native=q.get('variant')==='native',slot=q.get('focus')==='slot';
const style=document.createElement('style');style.textContent=STORY_THEME_CSS;document.head.append(style);
const prompts=[
 {identifier:'main',name:'酒馆主规则',role:'system',content:'角色 {{char}}'},
 {identifier:'charDescription',name:'酒馆角色资料',role:'system',marker:true},
 {identifier:'chatHistory',name:'酒馆历史',role:'system',marker:true},
 ...Array.from({length:370},(_,i)=>({identifier:'p'+i,name:'开关 '+i,role:'system',content:'<rule>'+i+'</rule>'}))];
const imported=parseStoryTheaterPreset(JSON.stringify({prompts,prompt_order:[
 {character_id:100001,order:prompts.map((p,i)=>({identifier:p.identifier,enabled:i<104}))}
]}),'373条模拟.json',1);
createRoot(document.getElementById('visual')!).render(React.createElement('div',{
 className:'story-theme story-theme-dark story-decor-plain h-full w-full'
},React.createElement(StoryPresetMaker,{preset:native?BUILTIN_NIGHT_SCREENING_PRESET:imported,
 onBack:()=>{},onSave:async()=>{},onOpenCopy:async()=>{},onDelete:async()=>{}})));
let entered=false,toggled=false;
const check=()=>{
 const buttons=[...document.querySelectorAll('button')];
 const pro=buttons.find(b=>b.textContent?.trim()==='专业版');
 if(!pro){setTimeout(check,100);return;}
 if(slot&&!native&&!entered){const group=buttons.find(b=>b.querySelector('strong')?.textContent==='自定义条目');
  if(group){group.click();entered=true;setTimeout(check,160);return;}}
 if(slot&&!native&&entered&&!toggled){const item=buttons.find(b=>b.textContent?.includes('酒馆角色资料'));
  const button=item?.parentElement?.querySelector('button');if(button&&!button.disabled){
    button.click();item?.click();toggled=true;setTimeout(check,160);return;}}
 const proOn=pro.className.includes('bg-white'),fit=document.documentElement.scrollWidth<=innerWidth;
 const count=document.querySelector('main')?.textContent?.includes('104/373')||false;
 const success=fit&&(native?!proOn:proOn&&(slot?toggled:count));
 document.body.dataset.storyPresetAuditReady=String(success);
 const output=document.createElement('output');output.hidden=true;output.id='story-preset-audit-report';
 output.textContent=JSON.stringify({native,slot,proOn,fit,count,toggled,success});document.body.append(output);
 if(!success)setTimeout(check,250);
};
setTimeout(check,900);
