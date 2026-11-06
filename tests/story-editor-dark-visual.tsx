import React from 'react';
import {createRoot} from 'react-dom/client';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import {STORY_THEME_CSS} from '../components/date/story/StoryTheaterTheme';
import {BUILTIN_NIGHT_SCREENING_PRESET,createStoryTheaterDraft,parseStoryTheaterPreset} from '../utils/storyTheater';

// This fixture renders the *real editor* and the *real story stylesheet* in Chrome.
// No imitation white-card HTML is used; only fake non-sensitive user data is supplied.
const host=document.getElementById('visual')!;
const root=createRoot(host);
const theme=document.createElement('style');theme.textContent=STORY_THEME_CSS;document.head.append(theme);
const params=new URLSearchParams(location.search);
const light=params.get('mode')==='light';
const scenario=params.get('scenario')||'selected';
const tavernPreset=parseStoryTheaterPreset(JSON.stringify({
    prompts:[
        {identifier:'main',name:'酒馆叙事规则',role:'system',content:'用 {{char}} 与 {{user}} 推进剧情'},
        {identifier:'charDescription',name:'酒馆角色资料',role:'system',marker:true},
        {identifier:'chatHistory',name:'酒馆历史',role:'system',marker:true},
        {identifier:'disabled-rule',name:'原本关闭的规则',role:'system',content:'保持关闭'},
    ],
    prompt_order:[{character_id:100001,order:[
        {identifier:'main',enabled:true},{identifier:'charDescription',enabled:true},
        {identifier:'chatHistory',enabled:true},{identifier:'disabled-rule',enabled:false},
    ]}],
}), '酒馆视觉测试.json', 1);
const actor={id:'visual-char',name:'故事角色',avatar:'',memories:[],mountedWorldbooks:[],systemPrompt:'一个角色',
    tavernGreetings:[{id:'tavern-first',title:'默认开场白',content:'雨夜的钟声响起，故事从这里开始。'}]} as any;
const customContent='黄昏的车站里，我推开了那扇门。';
const customGreeting={id:'custom-written',title:'黄昏车站',content:customContent};
const characters=scenario==='empty'||scenario==='customReady'
    ? [{...actor,tavernGreetings:[]}]
    : scenario==='customSaved'
    ? [{...actor,tavernGreetings:[customGreeting]}]
    : scenario==='customMulti'
    ? [{...actor,tavernGreetings:[]},{...actor,id:'visual-second',name:'第二角色',tavernGreetings:[]}]
    : [actor];
const entry={...createStoryTheaterDraft(),title:'真实时间陪伴 · 视觉验收',
    characterIds:scenario==='unselected'?[]:scenario==='customMulti'?[actor.id,'visual-second']:[actor.id],
    premise:scenario==='customReady'||scenario==='customMulti'?customContent:'',
    writesToCharacterMemory:true,carryCharacterMemory:true,
    openingMode:scenario==='manual'?'user' as const:'assistant' as const,
    ...(scenario==='tavern'?{presetId:tavernPreset.id}:{}),
    openingGreeting:['selected','editing'].includes(scenario)?{characterId:actor.id,greetingId:'tavern-first'}
        :scenario==='customSaved'?{characterId:actor.id,greetingId:customGreeting.id}:undefined};
root.render(React.createElement('div',{className:`story-theme ${light?'story-theme-light':'story-theme-dark'} story-decor-plain h-full w-full`},
    React.createElement(StoryTheaterEditor,{
        initial:entry,characters,user:{name:'用户'} as any,masks:[],maskLocked:false,
        presets:scenario==='tavern'?[tavernPreset,BUILTIN_NIGHT_SCREENING_PRESET]:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:()=>{},onSave:async()=>{},
        onImportPreset:async()=>null,onEditPreset:()=>{},onOpenMaskBox:()=>{},
    })));
if(scenario==='customMulti')setTimeout(()=>{
    document.querySelector<HTMLButtonElement>('button[data-story-opening-save="true"]')?.click();
},750);
if(scenario==='editing')setTimeout(()=>{
    const editor=document.querySelector<HTMLTextAreaElement>('textarea[data-story-opening-editor="true"]');
    [...(editor?.parentElement?.querySelectorAll('button')||[])].find(button=>button.textContent?.trim()==='修改')?.click();
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
    const openingEditor=document.querySelector<HTMLTextAreaElement>('textarea[data-story-opening-editor="true"]');
    const premiseEditor=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="剧情介绍"]');
    const bookmark=document.querySelector<HTMLButtonElement>('button[data-story-opening-save="true"]');
    const cast=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('让谁参与'));
    const rootTheme=document.querySelector<HTMLElement>('.story-theme');
    const presetSection=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('装载剧情预设'));
    const tavernVisible=!!presetSection?.querySelector('select')?.textContent?.includes('酒馆视觉测试')
        && !presetSection?.textContent?.includes('已适配酒馆预设')
        && !presetSection?.querySelector('.border-amber-200');
    if(buttons.length!==2||!card||!opening||!rootTheme)return false;
    const values={top:target(buttons[0]),bottom:target(buttons[1]),card:target(card),
        text:target(card.querySelector('.text-amber-700')),heading:target(card.querySelector('.text-amber-800'))};
    const report={...values,viewport:{width:innerWidth,height:innerHeight},
        functionsKept:buttons.every(b=>!b.hasAttribute('disabled'))&&buttons.every(b=>b.tagName==='BUTTON'),
        fit:document.documentElement.scrollWidth<=innerWidth,
        light,scenario,rootBackground:getComputedStyle(rootTheme).backgroundColor,
        openingEditorVisible:!!openingEditor,openingEditorLength:openingEditor?.value.length||0,
        bookmarkVisible:!!bookmark,bookmarkDisabled:bookmark?.disabled||false,
        openingIntegrated:openingSelect!==null
            && cast?.querySelector('select[aria-label="选择已有开场"]')===null
            && !document.body.textContent?.includes('Tavern opening') && !document.body.textContent?.includes('酒馆卡'),
        success:(scenario!=='tavern'||tavernVisible)
            && openingSelect!==null
            && opening?.querySelectorAll('select[aria-label="选择已有开场"]').length===1
            && (['selected','editing','customSaved'].includes(scenario)
                ? openingSelect?.value===`${actor.id}::${scenario==='customSaved'?customGreeting.id:'tavern-first'}`
                    && openingEditor?.value===(scenario==='customSaved'?customContent:'雨夜的钟声响起，故事从这里开始。')
                    && document.querySelectorAll('textarea[data-story-opening-editor="true"]').length===1
                    && !opening?.querySelector('textarea') // no extra preview/editor below the selector
                    && ![...(opening?.querySelectorAll('p')||[])].some(p=>p.textContent?.includes('雨夜的钟声响起'))
                    && (scenario!=='editing' || !![...(openingEditor?.parentElement?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==='保存修改'))
                : !openingEditor && !opening?.textContent?.includes('雨夜的钟声响起'))
            && (scenario==='customReady'||scenario==='customMulti'
                ? premiseEditor?.value===customContent && !!bookmark && !bookmark.disabled
                    && (scenario!=='customMulti' || !!document.querySelector('[data-story-opening-target="true"]'))
                : true)
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
    if (focus === 'opening') (openingEditor || premiseEditor || opening).scrollIntoView({block:'center',behavior:'instant'});
    if (focus === 'bottom') buttons[1].scrollIntoView({block:'center',behavior:'instant'});
    if (focus === 'preset') presetSection?.scrollIntoView({block:'start',behavior:'instant'});
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
