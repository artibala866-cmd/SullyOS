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
        {identifier:'html-side',name:'酒馆 HTML 小剧场',role:'system',content:'<sidestory><details><summary>小剧场</summary><div style="color:red">HTML/CSS 小剧场</div></details></sidestory>'},
        {identifier:'disabled-rule',name:'原本关闭的规则',role:'system',content:'保持关闭'},
    ],
    prompt_order:[{character_id:100001,order:[
        {identifier:'main',enabled:true},{identifier:'charDescription',enabled:true},
        {identifier:'chatHistory',enabled:true},{identifier:'html-side',enabled:true},{identifier:'disabled-rule',enabled:false},
    ]}],
    extensions: { regex_scripts: [{
        scriptName: '酒馆 HTML 美化仅作源文件测试', disabled: false,
        placement: [2], findRegex: '<sidestory>(.*?)</sidestory>', replaceString: '<div class="fancy">$1</div>',
    }] },
}), '酒馆视觉测试.json', 1);
const actor={id:'visual-char',name:'故事角色',avatar:'',memories:[],mountedWorldbooks:[],systemPrompt:'一个角色',
    tavernGreetings:[{id:'tavern-first',title:'默认开场白',content:'雨夜的钟声响起，故事从这里开始。'}]} as any;
const customContent='黄昏的车站里，我推开了那扇门。';
const customGreeting={id:'custom-written',title:'黄昏车站',content:customContent};
const legacyScene='{{char}}在夜色中走近。';
const legacyGreeting={id:'tavern-first',title:'备选开场白 6',content:'<!-- title: 开场白6 -->\n<!-- desc: 车站雨夜。 -->\n\n'+legacyScene};
const styledScene='雨夜 · 铁锈街\n烟头烫在水泥地上。{{char}}抬头看向{{user}}。';
const styledGreeting={id:'tavern-style-raw',title:'备选开场白 25',
    content:'<request:两个季淮北的称呼都是季淮北，禁止出现本体/IF的称呼>\n'
        +'<div style="margin:15px 0;font-family:\'PingFang SC\',sans-serif;">'
        +'<h3 style="background-color:#f0f4f8;color:#4c6680;padding:8px">雨夜 · 铁锈街</h3>'
        +'<p>烟头烫在水泥地上。{{char}}抬头看向{{user}}。</p></div>\n'
        +'[spotify: time machine | ˚˖ Music | https://assets.example.net/cover.gif | https://assets.example.net/track.mp3]\n'
        +'[spotify: 初雪 | ˚˖ Music | https://assets.example.net/cover.gif | https://assets.example.net/snow.mp3]\n'
        +'【音乐|Novocaine|"Overdosing over U."|[https://assets.example.net/novocaine.mp3|】](https://assets.example.net/novocaine.mp3|】)\n'
        +'!-- note: -->\n<!-- tag: sib -->\n'
        +'【音乐|Tictoc|"째깍."|\nhttps://external-cdn.example/media/clock.mp3|】\n'
        +'【音乐｜初雪｜无可用原生播放器｜https://another-cdn.example/snow.mp3｜】\n'
        +'[地图显示: 旧城 | https://assets.example.net/maps/embed?id=4]\n'
        +'<audio controls src="https://assets.example.net/sound.mp3"></audio>'
        +'<iframe src="https://assets.example.net/maps/embed?id=4"></iframe>'};
const linkGreeting={id:'link-visual-opening',title:'Link · 星河初遇',content:'<!-- Link 原始注释 -->\n{{char}}在星河下等待{{user}}。'};
const characters=scenario==='empty'||scenario==='customReady'||scenario==='customRecovered'
    ? [{...actor,tavernGreetings:[]}]
    : scenario==='customSaved'
    ? [{...actor,tavernGreetings:[customGreeting]}]
    : scenario==='customMulti'
    ? [{...actor,tavernGreetings:[]},{...actor,id:'visual-second',name:'第二角色',tavernGreetings:[]}]
    : ['legacy','autoNameTavern','autoNameManual'].includes(scenario)
    ? [{...actor,tavernGreetings:[legacyGreeting]}]
    : scenario==='autoNameLink'
    ? [{...actor,tavernGreetings:[],linkGreetings:[linkGreeting]}]
    : scenario==='styledTavern'
    ? [{...actor,tavernGreetings:[styledGreeting]}]
    : [actor];
const globalLoreBooks=Array.from({length:20},(_,i)=>({
    id:'global-lore-'+i,title:i===3?'十八岁平行世界':i===7?'末世地图':'世界书 '+i,
    content:'世界设定 '+i,category:i%2===0?'小说世界':'架空剧本',createdAt:1,updatedAt:1,
}));
const entry={...createStoryTheaterDraft(),title:['autoNameTavern','autoNameLink'].includes(scenario)?'':
    scenario==='autoNameManual'?'我自己命名的剧情':'真实时间陪伴 · 视觉验收',
    characterIds:['unselected','globalLore'].includes(scenario)?[]:scenario==='customMulti'?[actor.id,'visual-second']:[actor.id],
    premise:['customReady','customMulti','customRecovered'].includes(scenario)?customContent:'',
    writesToCharacterMemory:true,carryCharacterMemory:true,
    selectedWorldbookIds:scenario==='globalLore'?['global-lore-3','global-lore-7']:[],
    openingMode:scenario==='manual'?'user' as const:'assistant' as const,
    ...(scenario==='tavern'?{presetId:tavernPreset.id}:{}),
    openingGreeting:['selected','editing','legacy'].includes(scenario)?{characterId:actor.id,greetingId:'tavern-first'}
        :scenario==='styledTavern'?{characterId:actor.id,greetingId:styledGreeting.id}
        :scenario==='customSaved'?{characterId:actor.id,greetingId:customGreeting.id}:undefined};
root.render(React.createElement('div',{className:`story-theme ${light?'story-theme-light':'story-theme-dark'} story-decor-plain h-full w-full`},
    React.createElement(StoryTheaterEditor,{
        initial:entry,characters,worldbooks:scenario==='globalLore'?globalLoreBooks:[],user:{name:'用户'} as any,masks:[],maskLocked:false,
        presets:scenario==='tavern'?[tavernPreset,BUILTIN_NIGHT_SCREENING_PRESET]:[BUILTIN_NIGHT_SCREENING_PRESET],onCancel:()=>{},onSave:async()=>{},
        onImportPreset:async()=>null,onEditPreset:()=>{},onOpenMaskBox:()=>{},
        onCreateGreeting:async (_id:string,_title:string,content:string)=>({...customGreeting,content}),
    })));
if(['autoNameTavern','autoNameLink','autoNameManual'].includes(scenario))setTimeout(()=>{
    const selector=document.querySelector<HTMLSelectElement>('select[aria-label="选择已有开场"]');
    if(!selector)return;
    const option=[...selector.options].find(option=>option.value.endsWith(scenario==='autoNameLink'?'::link-visual-opening':'::tavern-first'));
    if(option){
        selector.value=option.value;
        selector.dispatchEvent(new Event('change',{bubbles:true}));
    }
},650);
if(scenario==='customRecovered')setTimeout(()=>{
    document.querySelector<HTMLButtonElement>('button[data-story-opening-save="true"]')?.click();
    setTimeout(()=>{
        [...document.querySelectorAll<HTMLButtonElement>('[data-story-opening-settings] button')].find(x=>x.textContent?.trim()==='我先写')?.click();
    },130);
},600);
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
    const titleInput=document.querySelector<HTMLInputElement>('input[placeholder="剧情名称"]');
    const cast=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('让谁参与'));
    const rootTheme=document.querySelector<HTMLElement>('.story-theme');
    const presetSection=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('装载剧情预设'));
    const loreSection=[...document.querySelectorAll('section')].find(section=>section.textContent?.includes('世界书沙盒'));
    const globalLoreOk=scenario!=='globalLore'||(
        !!loreSection && loreSection.querySelectorAll('button[aria-label^="世界书："]').length===20
        && loreSection.querySelector('button[aria-label="世界书：十八岁平行世界"]')?.getAttribute('aria-pressed')==='true'
        && loreSection.querySelector('button[aria-label="世界书：末世地图"]')?.getAttribute('aria-pressed')==='true'
        && !!loreSection.querySelector('input[aria-label="搜索剧情世界书"]')
        && !!loreSection.querySelector('[aria-label="剧情世界书列表"]')?.className.includes('max-h-[44vh]')
        && loreSection.textContent?.includes('已选 2')
        && !loreSection.textContent?.includes('所选角色没有挂载世界书')
        && !loreSection.textContent?.includes('暂无可选内容')
    );
    const tavernVisible=!!presetSection?.querySelector('select')?.textContent?.includes('酒馆视觉测试')
        && !!presetSection?.textContent?.includes('酒馆附带的正则/脚本没有执行')
        && !!presetSection?.textContent?.includes('小剧场支持隔离的安全 HTML 排版与原生卡片')
        && !presetSection?.querySelector('.border-amber-200');
    if(buttons.length!==2||!card||!opening||!rootTheme)return false;
    const values={top:target(buttons[0]),bottom:target(buttons[1]),card:target(card),
        text:target(card.querySelector('.text-amber-700')),heading:target(card.querySelector('.text-amber-800'))};
    const report={...values,globalLoreOk,viewport:{width:innerWidth,height:innerHeight},
        functionsKept:buttons.every(b=>!b.hasAttribute('disabled'))&&buttons.every(b=>b.tagName==='BUTTON'),
        fit:document.documentElement.scrollWidth<=innerWidth,
        light,scenario,rootBackground:getComputedStyle(rootTheme).backgroundColor,
        openingEditorVisible:!!openingEditor,openingEditorLength:openingEditor?.value.length||0,
        bookmarkVisible:!!bookmark,bookmarkDisabled:bookmark?.disabled||false,
        storyTitle:titleInput?.value||'',
        tavernVisualDiagnostics: scenario === 'tavern' ? {
            tavernVisible,
            presetExists: !!presetSection,
            presetOptions: presetSection?.querySelector('select')?.textContent?.slice(0, 240),
            regexText: !!presetSection?.textContent?.includes('酒馆附带的正则/脚本没有执行'),
            htmlText: !!presetSection?.textContent?.includes('小剧场支持隔离的安全 HTML 排版与原生卡片'),
            hasAmberBorder: !!presetSection?.querySelector('.border-amber-200'),
            openingSelect: !!openingSelect,
            openingSelectCount: opening?.querySelectorAll('select[aria-label="选择已有开场"]').length,
            castOpeningSelect: !!cast?.querySelector('select[aria-label="选择已有开场"]'),
            openingHasExample: !!opening?.textContent?.includes('雨夜的钟声响起'),
            bodyHasForbidden: !!document.body.textContent?.includes('酒馆卡') || !!document.body.textContent?.includes('Tavern opening'),
        } : undefined,
        openingIntegrated:openingSelect!==null
            && cast?.querySelector('select[aria-label="选择已有开场"]')===null
            && !document.body.textContent?.includes('Tavern opening') && !document.body.textContent?.includes('酒馆卡'),
        success:globalLoreOk && (scenario!=='tavern'||tavernVisible)
            && openingSelect!==null
            && opening?.querySelectorAll('select[aria-label="选择已有开场"]').length===1
            && (['autoNameTavern','autoNameLink','autoNameManual','styledTavern'].includes(scenario)
                ? !!openingEditor
                : ['selected','editing','customSaved','legacy'].includes(scenario)
                ? openingSelect?.value===`${actor.id}::${scenario==='customSaved'?customGreeting.id:'tavern-first'}`
                    && openingEditor?.value===(scenario==='customSaved'?customContent:scenario==='legacy'?legacyScene:'雨夜的钟声响起，故事从这里开始。')
                    && (scenario!=='legacy' || (openingSelect?.textContent?.includes('开场白6') && openingSelect?.textContent?.includes('车站雨夜') && !openingEditor?.value.includes('<!--')))
                    && document.querySelectorAll('textarea[data-story-opening-editor="true"]').length===1
                    && !opening?.querySelector('textarea') // no extra preview/editor below the selector
                    && ![...(opening?.querySelectorAll('p')||[])].some(p=>p.textContent?.includes('雨夜的钟声响起'))
                    && (scenario!=='editing' || !![...(openingEditor?.parentElement?.querySelectorAll('button')||[])].find(b=>b.textContent?.trim()==='保存修改'))
                : !openingEditor && !opening?.textContent?.includes('雨夜的钟声响起'))
            && (['customReady','customMulti','customRecovered'].includes(scenario)
                ? premiseEditor?.value===customContent && !!bookmark && !bookmark.disabled
                    && (scenario!=='customMulti' || !!document.querySelector('[data-story-opening-target="true"]'))
                    && (scenario!=='customRecovered' || (openingSelect?.value==='' && openingSelect?.textContent?.includes('黄昏车站')))
                : true)
            && (scenario==='styledTavern'
                ? openingSelect?.value===`${actor.id}::tavern-style-raw`
                    && !!openingEditor
                    && openingEditor.value.includes('雨夜 · 铁锈街')
                    && openingEditor.value.includes('烟头烫在水泥地上')
                    && !/<request|<div|<h3|style=|font-family|PingFang|spotify:|【音乐|Tictoc|Novocaine|Overdosing|tag: sib|note:|another-cdn|external-cdn|地图显示:|<iframe|<audio|assets\.example\.net|\.mp3|\.gif/i.test(openingEditor.value)
                    && !opening?.textContent?.includes('font-family')
                : true)
            && (['autoNameTavern','autoNameLink','autoNameManual','styledTavern'].includes(scenario)
                ? scenario==='styledTavern' ? !!openingEditor : titleInput?.value===(scenario==='autoNameTavern'?'开场白6':
                    scenario==='autoNameLink'?'Link · 星河初遇':'我自己命名的剧情')
                    && openingSelect?.value===`${actor.id}::${scenario==='autoNameLink'?'link-visual-opening':'tavern-first'}`
                    && openingEditor?.value===(scenario==='autoNameLink'?linkGreeting.content:legacyScene)
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
    if (focus === 'lore') loreSection?.scrollIntoView({block:'start',behavior:'instant'});
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
