import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { STORY_THEME_CSS } from '../components/date/story/StoryTheaterTheme';
import { BUILTIN_NIGHT_SCREENING_PRESET, createStoryTheaterDraft } from '../utils/storyTheater';
import { planStoryOpeningDocumentImport, readStoryOpeningDocuments } from '../utils/storyOpeningDocumentImport';
import type { TavernOpeningGreeting } from '../types';

const style=document.createElement('style');style.textContent=STORY_THEME_CSS;document.head.append(style);
const host=document.getElementById('opening-import-root')!;
const role={
    id:'opening-import-visual',name:'林屿',avatar:'',systemPrompt:'',worldview:'',
    memories:[],mountedWorldbooks:[],
    tavernGreetings:[{id:'tavern-original',title:'原作者开场',content:'原本的故事开场保留。'}],
} as any;
const entry={...createStoryTheaterDraft(),title:'雨夜 · 多篇开场白',premise:'雨夜相逢的前情介绍',
    characterIds:[role.id],openingMode:'assistant' as const};
let nextId=0;
function Fixture(){
    const [characters,setCharacters]=useState([role]);
    return <div className="story-theme story-theme-light story-decor-plain h-full w-full">
        <StoryTheaterEditor
            initial={entry} characters={characters} worldbooks={[]} user={{name:'我'} as any}
            masks={[]} maskLocked={false} presets={[BUILTIN_NIGHT_SCREENING_PRESET]}
            onCancel={()=>{}} onSave={async()=>{}} onImportPreset={async()=>null}
            onEditPreset={()=>{}} onOpenMaskBox={()=>{}}
            onImportGreetings={async(characterId,files)=>{
                const documents=await readStoryOpeningDocuments(files);
                const current=characters.find(x=>x.id===characterId);
                if(!current)throw Error('角色不匹配');
                const result=planStoryOpeningDocumentImport(
                    current.tavernGreetings, documents, [], ()=>`story-custom-visual-${++nextId}`);
                if(result.added.length) setCharacters([{...current,tavernGreetings:result.greetings}]);
                return {added:result.added as TavernOpeningGreeting[],skipped:result.skipped};
            }}
        />
    </div>;
}
createRoot(host).render(<Fixture/>);
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const run=async()=>{
    let picker:HTMLInputElement|null=null;
    for(let i=0;i<60;i++){picker=document.querySelector('input[aria-label="批量选择开场白文件"]');
        if(picker)break;await wait(80);}
    if(!picker)throw Error('批量导入控件未挂载');
    const zip=new JSZip();
    zip.file('word/document.xml','<w:document><w:body><w:p><w:r><w:t>第二幕：雨下得很大。</w:t></w:r></w:p></w:body></w:document>');
    const doc=new File([Uint8Array.from(await zip.generateAsync({type:'uint8array'})).buffer],'开场白2.docx');
    const files=[new File(['第十幕：最后一次见面。'],'开场白10.txt'),doc,
        new File(['第一幕：我们初次相遇。'],'开场白1.txt')];
    const transfer=new DataTransfer();
    files.forEach(file=>transfer.items.add(file));
    picker.files=transfer.files;
    picker.dispatchEvent(new Event('change',{bubbles:true}));
    let select:HTMLSelectElement|null=null;
    for(let i=0;i<90;i++){
        await wait(80);
        select=document.querySelector('select[aria-label="选择已有开场"]');
        if(select&&select.options.length>=5)break;
    }
    if(!select)throw Error('已有开场列表丢失');
    const customOptions=[...select.options].filter(o=>o.textContent?.includes('[自定义]'));
    const names=customOptions.map(o=>o.textContent?.trim()||'');
    const ordered=names.length===3&&names[0].includes('开场白1')&&names[1].includes('开场白2')&&names[2].includes('开场白10');
    const originalKept=[...select.options].some(o=>o.textContent?.includes('原作者开场'));
    const second=customOptions[1];
    if(second){select.value=second.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
    await wait(250);
    const textarea=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑开场内容"]');
    const importCard=document.querySelector<HTMLElement>('[data-story-opening-document-import]');
    const feedback=importCard?.textContent||'';
    const imported=feedback.includes('已导入 3 条')&&textarea?.value==='第二幕：雨下得很大。';
    const rect=importCard?.getBoundingClientRect();
    const noOverflow=document.documentElement.scrollWidth<=innerWidth && !!rect &&
       rect.right<=innerWidth+1 && rect.left>=-1;
    const report={ordered,originalKept,imported,noOverflow,selector:select.value,
        names,actorStable:select.value.startsWith(role.id+'::'),hasMultiPicker:picker.multiple};
    const result=document.createElement('output');result.id='story-opening-document-report';
    result.hidden=true;result.textContent=JSON.stringify(report);document.body.append(result);
    document.body.dataset.storyOpeningImportReady=String(Object.values(report)
        .filter(x=>typeof x==='boolean').every(Boolean));
    importCard?.scrollIntoView({block:'center',behavior:'instant'});
};
run().catch(error=>{
    document.body.dataset.storyOpeningImportReady='false';
    document.body.dataset.storyOpeningImportError=String(error?.stack||error).slice(0,2000);
});
