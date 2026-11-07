/** Actual UserApp import control and confirmation dialog in Chromium, not a mock layout. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UserApp from '../apps/UserApp';
import { makeImportFixturePdf } from './import-fixture-pdf';
import { OSPreviewProvider } from '../context/OSContext';

const source=new URLSearchParams(location.search).get('source')||'user-profile';
const observed:string[]=[];
window.addEventListener('error',e=>observed.push(e.message));
window.addEventListener('unhandledrejection',e=>observed.push(String(e.reason)));
const imported='从文件导入的经历。\n我喜欢旅行和画画。';
const InitialBio='原本的个人资料不能被意外覆盖。';
const Preview=()=>{
    const [profile,setProfile]=useState({name:'测试档案',avatar:'',bio:InitialBio});
    const context={
        closeApp:()=>{},
        userProfile:profile,
        characters:[],
        addToast:(message:string)=>{(window as any).__userImportToast=message},
        updateUserProfile:async(update:any)=>{
            setProfile(prev=>{
                const patch=typeof update==='function'?update(prev):update;
                const next={...prev,...patch};
                (window as any).__savedUserBio=next.bio;
                return next;
            });
        },
        theme:{},
    } as any;
    return <OSPreviewProvider value={context}><UserApp/></OSPreviewProvider>;
};
createRoot(document.getElementById('root')!).render(<Preview/>);
async function waitFor<T>(fn:()=>T,what:string):Promise<T>{
    for(let i=0;i<110;i++){
        const result=fn();
        if(result)return result;
        await new Promise(r=>setTimeout(r,80));
    }
    throw Error('Timeout: '+what);
}
async function run(){
 try {
    const trigger=await waitFor(()=>document.querySelector<HTMLButtonElement>('button[aria-label="导入个人设定文件"]'),'user profile import button');
    trigger.scrollIntoView({block:'center'});
    await new Promise(r=>setTimeout(r,120));
    const input=document.querySelector<HTMLInputElement>('input[aria-label="选择 TXT Word PDF 个人设定文件"]')!;
    if(!input||!input.accept.includes('.pdf')||!input.accept.includes('.docx'))throw Error('UserApp input formats missing');
    const files=new DataTransfer();
    files.items.add(source==='user-profile-pdf' ? makeImportFixturePdf('PDF USER PROFILE TEXT','我的PDF档案.pdf') : new File([imported],'我的真实资料.txt',{type:'text/plain'}));
    input.files=files.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const dialog=await waitFor(()=>document.querySelector<HTMLElement>('[role="dialog"][aria-label="导入个人设定"]'),'actual import confirmation');
    const confirm=[...dialog.querySelectorAll('button')].find(x=>x.textContent?.includes('确认导入')) as HTMLButtonElement|undefined;
    const append=dialog.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    const replace=[...dialog.querySelectorAll('button')].find(x=>x.textContent?.trim()==='替换') as HTMLButtonElement|undefined;
    if(!confirm||!append||!replace)throw Error('Import modal append/replace controls missing');
    const primaryBackground=getComputedStyle(confirm).backgroundColor;
    const selectedBackground=getComputedStyle(append).backgroundColor;
    const unselectedBackground=getComputedStyle(replace).backgroundColor;
    const confirmRect=confirm.getBoundingClientRect();
    if(['transparent','rgba(0, 0, 0, 0)'].includes(primaryBackground) ||
        primaryBackground===getComputedStyle(dialog).backgroundColor)
        throw Error('Confirm import button visually invisible');
    if(selectedBackground===unselectedBackground)
        throw Error('Append/replace selection is not visibly distinguishable');
    if(confirmRect.height<36||confirmRect.bottom>innerHeight+1)
        throw Error('Confirm import button clipped by viewport');
    const before=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="关于我 / 设定"]');
    if(!before||before.value!==InitialBio)throw Error('Import preview changed original biography before confirmation');
    if(source==='user-profile-saved'){
        confirm.click();
        await waitFor(()=>document.querySelector<HTMLTextAreaElement>('textarea[aria-label="关于我 / 设定"]')?.value.includes(imported),'saved bio');
        if(document.querySelector('[role="dialog"]'))throw Error('Import dialog did not close');
    }
    if(source==='user-profile-replace'){
        replace.click();
        await new Promise(r=>setTimeout(r,70));
        confirm.click();
        await waitFor(()=>document.querySelector<HTMLTextAreaElement>('textarea[aria-label="关于我 / 设定"]')?.value===imported,'replaced bio');
    }
    const value=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="关于我 / 设定"]')?.value||'';
    const allText=document.body.textContent||'';
    const bounds=trigger.getBoundingClientRect();
    const report={
        source,viewport:[innerWidth,innerHeight],
        beforeUnchanged:source.startsWith('user-profile'),
        contentCorrect:(source==='user-profile'||source==='user-profile-pdf')?value===InitialBio:source==='user-profile-replace'
            ?value===imported:value===InitialBio+'\n\n'+imported,
        noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth+2,
        triggerVisible:bounds.width>50&&bounds.right<=innerWidth,
        fileFormats:input.accept,
        dialogShown:(source==='user-profile'||source==='user-profile-pdf')?!!document.querySelector('[role="dialog"]'):!document.querySelector('[role="dialog"]'),
        appendDefault:append.textContent?.trim()==='追加',
        wordAndPdfLabel:allText.includes('TXT · Word · PDF'),
        actualPdfParsed:source!=='user-profile-pdf' || (dialog.textContent||'').includes('PDF USER PROFILE TEXT'),
        pdfPages:source!=='user-profile-pdf' || (dialog.textContent||'').includes('PDF · 1 页'),
        errors:observed,
    };
    const pass=report.beforeUnchanged&&report.contentCorrect&&report.noHorizontalOverflow&&
        report.triggerVisible&&report.dialogShown&&report.appendDefault&&report.wordAndPdfLabel&&
        report.actualPdfParsed&&report.pdfPages&&!observed.length;
    document.body.dataset.cardImportVisualReady=String(pass);
    document.getElementById('qa-report')!.textContent=JSON.stringify(report);
 }catch(error){
    document.body.dataset.cardImportVisualReady='false';
    document.getElementById('qa-report')!.textContent=String(error instanceof Error?error.stack:error);
 }
}
void run();
