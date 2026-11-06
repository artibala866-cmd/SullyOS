import React from 'react';
import {createRoot} from 'react-dom/client';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import {STORY_THEME_CSS} from '../components/date/story/StoryTheaterTheme';
import {BUILTIN_NIGHT_SCREENING_PRESET,createStoryTheaterDraft} from '../utils/storyTheater';

// This fixture renders the *real editor* and the *real story stylesheet* in Chrome.
// No imitation white-card HTML is used; only fake non-sensitive user data is supplied.
const host=document.getElementById('visual')!;
const root=createRoot(host);
const theme=document.createElement('style');theme.textContent=STORY_THEME_CSS;document.head.append(theme);
const params=new URLSearchParams(location.search);
const light=params.get('mode')==='light';
const scenario=params.get('scenario')||'selected';
const actor={id:'visual-char',name:'故事角色',avatar:'',memories:[],mountedWorldbooks:[],systemPrompt:'一个角色',
    tavernGreetings:[{id:'tavern-first',title:'默认开场白',content:'雨夜的钟声响起，故事从这里开始。'}]} as any;
const characters=scenario==='empty'?[{...actor,tavernGreetings:[]}]:[actor];
const entry={...createStoryTheaterDraft(),title:'真实时间陪伴 · 视觉验收',characterIds:scenario==='unselected'?[]:[actor.id],writesToCharacterMemory:true,carryCharacterMemory:true,
    openingMode:scenario==='manual'?'user' as const:'assistant' as const,
    openingGreeting:['selected','editing'].includes(scenario)?{characterId:actor.id,greetingId:'tavern-first'}:undefined};
root.render(React.createElement('div',{className:`story-theme ${light?'story-theme-light':'story-theme-dark'} story-decor-plain h-full w-full`},
    React.createElement(StoryTheaterEditor,{
        initial:entry,characters,user:{name:'用户'} as any,masks:[],maskLocked:false,
        presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:()=>{},onSave:async()=>{},
        onImportPreset:async()=>null,onEditPreset:()=>{},onOpenMaskBox:()=>{},
    })));
if(scenario==='editing')setTimeout(()=>{
    const opening=document.querySelector<HTMLElement>('[data-story-opening-settings="true"]');
    [...(opening?.querySelectorAll('button')||[])].find(button=>button.textContent?.trim()==='修改')?.click();
},750);
const target=(element:Element|null)=>{
    if(!element)return {exists:false,color:'',background:''};
    const c=getComputedStyle(element);
    return {exists:true,color:c.color,background:c.backgroundColor};
};
const validate=()=>{
    const buttons=[...document.querySelectorAll<HTMLElement>('.story-setup-save')];
    const card=document.querySelector<HTMLElement>('.story-memory-live-card');
    const opening=document.querySelector<HTMLElement>('[data-story-opening-settings="true"]');
    const openingSelect=opening?.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]');
    const openingEditor=opening?.querySelector<HTMLTextAreaElement>('textarea[data-story-opening-editor="true"]');
    const cast=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('让谁参与'));
    const rootTheme=document.querySelector<HTMLElement>('.story-theme');
    if(buttons.length!==2||!card||!opening||!rootTheme)return false;
    const values={top:target(buttons[0]),bottom:target(buttons[1]),card:target(card),
        text:target(card.querySelector('.text-amber-700')),heading:target(card.querySelector('.text-amber-800'))};
    const report={...values,viewport:{width:innerWidth,height:innerHeight},
        functionsKept:buttons.every(b=>!b.hasAttribute('disabled'))&&buttons.every(b=>b.tagName==='BUTTON'),
        fit:document.documentElement.scrollWidth<=innerWidth,
        light,scenario,rootBackground:getComputedStyle(rootTheme).backgroundColor,
        openingEditorVisible:!!openingEditor,openingEditorLength:openingEditor?.value.length||0,
        openingIntegrated:openingSelect!==null
            && cast?.querySelector('select[aria-label="选择已有开场"]')===null
            && !document.body.textContent?.includes('Tavern opening') && !document.body.textContent?.includes('酒馆卡'),
        success:openingSelect!==null
            && opening?.querySelectorAll('select[aria-label="选择已有开场"]').length===1
            && (['selected','editing'].includes(scenario)
                ? openingSelect?.value===`${actor.id}::tavern-first`
                    && openingEditor?.value==='雨夜的钟声响起，故事从这里开始。'
                    && opening?.querySelectorAll('textarea[data-story-opening-editor="true"]').length===1
                    && ![...(opening?.querySelectorAll('p')||[])].some(p=>p.textContent?.includes('雨夜的钟声响起'))
                    && (scenario!=='editing' || !![...(opening?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==='保存修改'))
                : !openingEditor && !opening?.textContent?.includes('雨夜的钟声响起'))
            && (scenario==='manual'
                ? !openingSelect?.hasAttribute('disabled') && openingSelect?.querySelector('option')?.textContent==='选择已有开场'
                : scenario==='auto'
                ? !openingSelect?.hasAttribute('disabled') && openingSelect?.querySelector('option')?.textContent==='自动写第一幕'
                : scenario==='empty'
                ? openingSelect?.hasAttribute('disabled') && openingSelect?.querySelector('option')?.textContent==='暂无可选开场'
                : scenario==='unselected'
                ? openingSelect?.hasAttribute('disabled') && openingSelect?.querySelector('option')?.textContent==='先选择参与角色'
                : true)
            && cast?.querySelector('select[aria-label="选择已有开场"]')===null
            && !document.body.textContent?.includes('Tavern opening') && !document.body.textContent?.includes('酒馆卡')
            && (light
                ? getComputedStyle(rootTheme).backgroundColor==='rgb(243, 243, 243)'
                : values.top.background==='rgb(66, 66, 66)'&&values.bottom.background==='rgb(66, 66, 66)'
                    &&values.card.background==='rgb(48, 48, 48)'
                    &&values.text.color==='rgb(201, 201, 201)'&&values.heading.color==='rgb(239, 239, 239)')
            &&document.documentElement.scrollWidth<=innerWidth,
    };
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus === 'memory') card.scrollIntoView({block:'center',behavior:'instant'});
    if (focus === 'opening') opening.scrollIntoView({block:'center',behavior:'instant'});
    if (focus === 'bottom') buttons[1].scrollIntoView({block:'center',behavior:'instant'});
    document.body.dataset.storyGrayReady=String(report.success);
    const output=document.createElement('output');output.id='story-gray-browser-report';output.hidden=true;
    output.textContent=JSON.stringify(report);document.body.append(output);
    return true;
};
const begin=Date.now();
const poll=()=>{
    if(validate())return;
    if(Date.now()-begin>8000){document.body.dataset.storyGrayReady='false';return;}
    setTimeout(poll,80);
};
setTimeout(poll,1200);
