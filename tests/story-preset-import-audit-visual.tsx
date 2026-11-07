import React from 'react';
import { createRoot } from 'react-dom/client';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import { STORY_THEME_CSS } from '../components/date/story/StoryTheaterTheme';
import { BUILTIN_NIGHT_SCREENING_PRESET, getStoryPresetPromptGroups, parseStoryTheaterPreset } from '../utils/storyTheater';

const q = new URLSearchParams(location.search);
const native = q.get('variant') === 'native';
const focus = q.get('focus') || 'overview';
const style = document.createElement('style');
style.textContent = STORY_THEME_CSS;
document.head.append(style);

const titles = ['抢话▣▣权限','语言▣▣设置','视角▣▣设置','剧情▣▣节奏','情绪▣▣温度',
    '对话▣▣占比','文风▣▣选择','小剧场▣▣设置','世界▣▣设定','输出▣▣格式','剧本▣▣补充'];
const prompts = [
    { identifier:'main',name:'酒馆主规则',role:'system',content:'角色 {{char}}' },
    { identifier:'charDescription',name:'酒馆角色资料',role:'system',marker:true },
    { identifier:'chatHistory',name:'酒馆历史',role:'system',marker:true },
    ...Array.from({length:370},(_,i)=>({
        identifier:'p'+i,
        name:i > 0 && i % 31 === 0 ? '<==' + titles[(i/31-1)%titles.length] + '==>' : '开关 '+i,
        role:'system',
        content:i > 0 && i % 31 === 0 ? '' : '<rule>作者正文 '+i+'</rule>',
    })),
];
const imported = parseStoryTheaterPreset(JSON.stringify({prompts,prompt_order:[
    {character_id:100001,order:prompts.map((p,i)=>({identifier:p.identifier,enabled:i<104}))}
]}),'373条模拟.json',1);
const groups = getStoryPresetPromptGroups(imported.document);
const authoredIds = imported.document.prompts.map(p=>p.id);
const groupingSafe = groups.length >= 11
    && groups.flatMap(group=>group.promptIds).join('|')===authoredIds.join('|')
    && groups.every(group=>group.autoGrouped)
    && imported.document.prompts.filter(p=>p.enabled).length===104;
createRoot(document.getElementById('visual')!).render(
    React.createElement('div',{className:'story-theme story-theme-dark story-decor-plain h-full w-full'},
        React.createElement(StoryPresetMaker,{
            preset:native ? BUILTIN_NIGHT_SCREENING_PRESET : imported,
            onBack:()=>{},onSave:async()=>{},onOpenCopy:async()=>{},onDelete:async()=>{},
        }),
    ),
);

let stage = 0;
let markerToggled = false;
let detailSelected = false;
const clickByText = (fragment:string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(button=>button.textContent?.includes(fragment));
const inputText = (input:HTMLInputElement,value:string) => {
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    setter?.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
};
const check=()=>{
    const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')];
    const pro=buttons.find(b=>b.textContent?.trim()==='专业版');
    if(!pro){setTimeout(check,100);return;}
    if(!native && focus==='slot'){
        if(stage===0){const group=clickByText('预设开头');
            if(group){group.click();stage=1;setTimeout(check,120);return;}}
        if(stage===1){const item=clickByText('酒馆角色资料');
            const toggle=item?.parentElement?.querySelector<HTMLButtonElement>('button');
            if(item && toggle && !toggle.disabled){
                toggle.click();item.click();markerToggled=true;stage=2;setTimeout(check,120);return;}}
    }
    if(!native && focus==='deep'){
        if(stage===0) {
            const search=document.querySelector<HTMLInputElement>('input[aria-label="搜索酒馆预设提示词"]');
            if(search){inputText(search,'开关 369');stage=1;setTimeout(check,130);return;}
        }
        if(stage===1){const group=buttons.find(b=>b.querySelector('strong') && /其他条目|设置|选择|补充/.test(b.textContent||''));
            if(group){group.click();stage=2;setTimeout(check,130);return;}}
        if(stage===2){const item=clickByText('开关 369');
            if(item){item.click();stage=3;setTimeout(check,150);return;}}
    }
    const proOn=pro.className.includes('bg-white');
    const fit=document.documentElement.scrollWidth<=innerWidth;
    const overview=Boolean(document.querySelector('input[aria-label="搜索酒馆预设提示词"]'));
    const quickEditor=Boolean(document.querySelector('button') &&
        clickByText('返回提示词列表') && !document.querySelector('input[aria-label="搜索组内提示词"]'));
    const selectedTextarea=document.querySelector<HTMLTextAreaElement>('textarea');
    detailSelected=focus==='deep' && quickEditor
        && Boolean(selectedTextarea?.value.includes('作者正文 369'));
    const success=fit && (native ? !proOn : proOn && groupingSafe && (
        focus==='overview' ? overview : focus==='slot'
            ? markerToggled && quickEditor
            : detailSelected));
    document.body.dataset.storyPresetAuditReady=String(success);
    let output=document.getElementById('story-preset-audit-report');
    if(!output){output=document.createElement('output');output.hidden=true;output.id='story-preset-audit-report';document.body.append(output);}
    output.textContent=JSON.stringify({
        native,focus,proOn,fit,groupCount:groups.length,groupingSafe,
        markerToggled,quickEditor,detailSelected,stage,
        names:groups.slice(0,8).map(g=>g.label),success,
    });
    if(!success && stage < 3)setTimeout(check,200);
};
setTimeout(check,950);
