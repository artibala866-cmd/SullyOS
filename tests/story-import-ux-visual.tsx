import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import {STORY_THEME_CSS} from '../components/date/story/StoryTheaterTheme';
import {BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft, createBlankStoryPreset, parseStoryTheaterPreset} from '../utils/storyTheater';
import type {StoryTheaterPreset} from '../types';

const css=document.createElement('style');css.textContent=STORY_THEME_CSS;document.head.append(css);
const role={id:'role',name:'林屿',avatar:'',systemPrompt:'',worldview:'',memories:[],mountedWorldbooks:[],
    tavernGreetings:[
        {id:'original',title:'作者原始开场',content:'故事由雨夜开始。'},
        ...Array.from({length:38},(_,i)=>({
            id:'story-custom-ux-'+(i+1),title:'开场白'+(i+1),
            content:'这是第'+(i+1)+'条开场白，雨落在窗边。'
        })),
    ]} as any;
const draft={...createStoryTheaterDraft(1),title:'雨夜 · 长篇开场',premise:'两个角色的一次相遇',characterIds:[role.id]};
function App(){
    const [presets,setPresets]=useState<StoryTheaterPreset[]>([BUILTIN_NIGHT_SCREENING_PRESET]);
    return <div className="story-theme story-theme-light story-decor-plain h-full w-full">
        <StoryTheaterEditor initial={draft} characters={[role]} worldbooks={[]}
            user={{name:'用户'} as any} masks={[]} maskLocked={false} presets={presets}
            onCancel={()=>{}} onSave={async()=>{}}
            onImportPreset={async file=>{
                const item=parseStoryTheaterPreset(await file.text(),file.name);
                setPresets(current=>[...current,item]);
                return item;
            }} onEditPreset={()=>{}} onOpenMaskBox={()=>{}} />
    </div>;
}
createRoot(document.getElementById('visual')!).render(<App/>);
const presetFile=(name:string)=>new File([JSON.stringify(createBlankStoryPreset(name).document)],name+'.json',{type:'application/json'});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const changeText=(input:HTMLInputElement,text:string)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);
    input.dispatchEvent(new Event('input',{bubbles:true}));
};
async function waitFor(check:()=>boolean) {
    for(let i=0;i<90;i++){if(check())return;await sleep(30);}
    throw new Error('导入流程没有完成预期操作');
}
async function run(){
    document.body.dataset.storyImportUxStage='mount';
    await waitFor(()=>!!document.querySelector('input[aria-label="搜索已有开场白"]'));
    document.body.dataset.storyImportUxStage='search-mounted';
    const search=document.querySelector<HTMLInputElement>('input[aria-label="搜索已有开场白"]')!;
    changeText(search,'开场白29');
    const options=()=>[...document.querySelectorAll<HTMLOptionElement>('select[aria-label="选择已有开场"] option')];
    const isFiltered=()=>options().some(o=>o.textContent?.includes('开场白29'))
        && !options().some(o=>o.textContent?.includes('开场白18'));
    await waitFor(isFiltered);
    const filtered=isFiltered();
    document.body.dataset.storyImportUxStage='search-complete';
    const presetSelect=()=>document.querySelector<HTMLSelectElement>('select:not([aria-label]):has(option[value="builtin-night-screening"])');
    const initial=presetSelect()?.value||'';
    const uploader=document.querySelector<HTMLInputElement>('input[type="file"][accept*="application/json"]')!;
    const transfer=new DataTransfer();
    for(const num of [1,2,3])transfer.items.add(presetFile('导入预设'+num));
    uploader.files=transfer.files;uploader.dispatchEvent(new Event('change',{bubbles:true}));
    document.body.dataset.storyImportUxStage='batch-dispatched';
    await waitFor(()=>document.body.textContent?.includes('已导入或找到 3 份预设')||false);
    // A real user cannot choose another file until the busy button re-enables.
    // The synthetic DataTransfer event must respect the same UI transition.
    await waitFor(()=>!document.querySelector<HTMLButtonElement>('button[aria-label="导入剧情预设"]')?.disabled);
    document.body.dataset.storyImportUxStage='batch-complete';
    const preserved=presetSelect()?.value===initial;
    const batchFeedback=!!document.body.textContent?.includes('当前剧情预设未改变');
    const single=new DataTransfer();single.items.add(presetFile('单独选中'));
    uploader.files=single.files;uploader.dispatchEvent(new Event('change',{bubbles:true}));
    await waitFor(()=>presetSelect()?.selectedOptions?.[0]?.textContent==='单独选中');
    document.body.dataset.storyImportUxStage='single-complete';
    const singleSelected=presetSelect()?.selectedOptions?.[0]?.textContent==='单独选中';
    const fit=document.documentElement.scrollWidth<=innerWidth;
    const result={filtered,preserved,batchFeedback,singleSelected,fit,optionsAfterSearch:options().length};
    const node=document.createElement('output');node.id='story-import-ux-report';node.hidden=true;node.textContent=JSON.stringify(result);document.body.append(node);
    document.body.dataset.storyImportUxReady=String(Object.entries(result).filter(([k])=>k!=='optionsAfterSearch').every(([,v])=>v===true));
    const focus=new URLSearchParams(location.search).get('focus');
    if(focus==='preset')presetSelect()?.scrollIntoView({block:'center',behavior:'instant'});
    else search.scrollIntoView({block:'center',behavior:'instant'});
}
void run().catch(error=>{document.body.dataset.storyImportUxReady='false';document.body.dataset.storyImportUxError=String(error?.stack||error).slice(0,2000);});
