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
const actor={id:'visual-char',name:'故事角色',avatar:'',memories:[],mountedWorldbooks:[],systemPrompt:'一个角色',
    tavernGreetings:[{id:'tavern-first',title:'默认开场白',content:'雨夜的钟声响起，故事从这里开始。'}]} as any;
const entry={...createStoryTheaterDraft(),title:'真实时间陪伴 · 视觉验收',characterIds:[actor.id],writesToCharacterMemory:true,carryCharacterMemory:true,
    openingMode:'assistant' as const,openingGreeting:{characterId:actor.id,greetingId:'tavern-first'}};
root.render(React.createElement('div',{className:'story-theme story-theme-dark story-decor-plain h-full w-full'},
    React.createElement(StoryTheaterEditor,{
        initial:entry,characters:[actor],user:{name:'用户'} as any,masks:[],maskLocked:false,
        presets:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:()=>{},onSave:async()=>{},
        onImportPreset:async()=>null,onEditPreset:()=>{},onOpenMaskBox:()=>{},
    })));
const target=(element:Element|null)=>{
    if(!element)return {exists:false,color:'',background:''};
    const c=getComputedStyle(element);
    return {exists:true,color:c.color,background:c.backgroundColor};
};
const validate=()=>{
    const buttons=[...document.querySelectorAll<HTMLElement>('.story-setup-save')];
    const card=document.querySelector<HTMLElement>('.story-memory-live-card');
    const opening=document.querySelector<HTMLElement>('[data-story-opening-settings="true"]');
    const openingSelect=opening?.querySelector('select[aria-label="选择已有开场"]');
    const cast=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('让谁参与'));
    if(buttons.length!==2||!card||!opening||!openingSelect)return false;
    const values={top:target(buttons[0]),bottom:target(buttons[1]),card:target(card),
        text:target(card.querySelector('.text-amber-700')),heading:target(card.querySelector('.text-amber-800'))};
    const report={...values,viewport:{width:innerWidth,height:innerHeight},
        functionsKept:buttons.every(b=>!b.hasAttribute('disabled'))&&buttons.every(b=>b.tagName==='BUTTON'),
        fit:document.documentElement.scrollWidth<=innerWidth,
        openingIntegrated:openingSelect!==null && cast?.querySelector('select[aria-label="选择已有开场"]')===null
            && !document.body.textContent?.includes('Tavern opening') && !document.body.textContent?.includes('酒馆卡'),
        success:openingSelect!==null && cast?.querySelector('select[aria-label="选择已有开场"]')===null
            && !document.body.textContent?.includes('Tavern opening') && !document.body.textContent?.includes('酒馆卡')
            &&values.top.background==='rgb(66, 66, 66)'&&values.bottom.background==='rgb(66, 66, 66)'
            &&values.card.background==='rgb(48, 48, 48)'
            &&values.text.color==='rgb(201, 201, 201)'&&values.heading.color==='rgb(239, 239, 239)'
            &&document.documentElement.scrollWidth<=innerWidth,
    };
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus === 'memory') card.scrollIntoView({block:'center',behavior:'instant'});
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
