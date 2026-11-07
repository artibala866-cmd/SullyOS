/* Actual WorldbookApp UI: synthetic Link native JSON + TXT multi-import.
 * Keeps source files private; no screen mockup or fixed text pretending to be the UI.
 */
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../context/OSContext';
import WorldbookApp from '../apps/WorldbookApp';
import { makeImportFixturePdf } from './import-fixture-pdf';
import { makeImportFixtureWord } from './import-fixture-word';
import type {Worldbook} from '../types';

const errors:string[]=[];
window.addEventListener('error',event=>errors.push(event.message));
window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
let lastImported:Worldbook[]=[];
const sys={
    closeApp:()=>{},characters:[],activeCharacterId:'',addCharacter:async()=>null,
    updateCharacter:()=>{},setActiveCharacterId:()=>{},
    worldbooks:[],addWorldbook:()=>{},updateWorldbook:async()=>{},
    deleteWorldbook:async()=>{},updateWorldbooks:async()=>{},
    deleteWorldbooks:async()=>{},theme:{},addToast:()=>{},
} as any;
const LiveWorldbook=()=>{
    const [books,setBooks]=useState<Worldbook[]>([]);
    return <OSPreviewProvider value={{
        ...sys,worldbooks:books,
        importWorldbooks:async(rows:Worldbook[])=>{
            lastImported=rows;
            setBooks(old=>[...old,...rows]);
            return {added:rows.length,updated:0,skipped:0,conflicts:0};
        },
        addToast:(message:string)=>{(window as any).__worldbookToast=message;},
    }}><WorldbookApp/></OSPreviewProvider>;
};
createRoot(document.getElementById('root')!).render(<LiveWorldbook/>);
const link={
    worldBooks:[{
        id:'source-book',title:'Link世界设定',scope:'local',enabled:true,
        entries:[
            {id:'a',title:'好友背景',content:'角色的完整关系',activation:'keyword',keys:['旧友'],enabled:true,position:'before-chat'},
            {id:'b',title:'城市信息',content:'城市正文',activation:'constant',enabled:false,position:'after-chat'},
        ],
    }],
};
const box=(el:Element|null)=>{
    if(!el)return null;const r=el.getBoundingClientRect();
    return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};
};
async function run(){
    try{
        let input:HTMLInputElement|null=null;
        for(let i=0;i<100&&!input;i++){
            input=document.querySelector<HTMLInputElement>('input[type=file][multiple]');
            if(!input)await new Promise(r=>setTimeout(r,80));
        }
        if(!input)throw Error('WorldbookApp multiple-file import input missing');
        const button=document.querySelector<HTMLButtonElement>('button[title="导入标准世界书"]');
        if(!button)throw Error('WorldbookApp import button missing');
        button.click();
        await new Promise(r=>setTimeout(r,180));
        const modal=[...document.querySelectorAll('h3')].find(x=>x.textContent?.includes('导入世界书'));
        if(!modal)throw Error('Import confirmation modal not displayed');
        const confirm=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='确定') as HTMLButtonElement|undefined;
        if(!confirm)throw Error('Import confirmation action missing');
        confirm.click();
        await new Promise(r=>setTimeout(r,100));
        if([...document.querySelectorAll('h3')].some(x=>x.textContent?.includes('导入世界书')))
            throw Error('Import confirmation modal did not close after clicking confirm');
        const transfer=new DataTransfer();
        transfer.items.add(new File([JSON.stringify(link)],'link-worldbooks.json',{type:'application/json'}));
        transfer.items.add(new File(['这是一份完整世界观文档。'],'旅行故事.txt',{type:'text/plain'}));
        transfer.items.add(makeImportFixturePdf('PDF WORLD BOOK STORY','PDF世界书.pdf'));
        transfer.items.add(await makeImportFixtureWord('WORD BOOK STORY\n第二段','Word世界书.docx'));
        input.files=transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        for(let n=0;n<100&&lastImported.length!==5;n++)await new Promise(r=>setTimeout(r,100));
        await new Promise(r=>setTimeout(r,150));
        const root=document.documentElement,view=[innerWidth,innerHeight];
        const cards=[...document.querySelectorAll('h3')].map(el=>el.textContent?.trim()||'').filter(value=>value.includes('Link世界设定')||value.includes('旅行故事')||value.includes('PDF世界书')||value.includes('Word世界书'));
        const doc=document.body.textContent||'';
        const result={
            viewport:view,selectedFileCount:4,importedCount:lastImported.length,
            grouped:cards,warningCount:errors.length,
            noOverflowX:root.scrollWidth<=innerWidth+2,
            titleFits:!([...document.querySelectorAll('span')].filter(x=>x.textContent?.trim()==='世界书').some(el=>el.getBoundingClientRect().height>40)),
            inputMulti:input.multiple,acceptedWord:input.accept.includes('.docx'),
            uiVisible:!!document.querySelector('button[title="导入标准世界书"]'),
            linkedBook:cards.some(x=>x.includes('Link世界设定')),
            documentBook:cards.some(x=>x.includes('旅行故事')),
            pdfBook:lastImported.some(x=>x.title==='PDF世界书'&&x.content.includes('PDF WORLD BOOK STORY')),
            wordBook:lastImported.some(x=>x.title==='Word世界书'&&x.content.includes('WORD BOOK STORY')&&x.content.includes('第二段')),
            acceptedPdf:input.accept.includes('.pdf'),
            disabledBookImported:lastImported.some(x=>x.title==='城市信息'&&x.disable===true),
            keywordImported:lastImported.some(x=>x.title==='好友背景'&&x.key?.includes('旧友')),
            errors,
        };
        const pass=result.importedCount===5&&result.pdfBook&&result.wordBook&&result.acceptedPdf&&result.noOverflowX&&result.titleFits&&result.inputMulti&&
            result.acceptedWord&&result.uiVisible&&result.linkedBook&&result.documentBook&&
            result.disabledBookImported&&result.keywordImported&&!errors.length;
        document.body.dataset.cardImportVisualReady=String(pass);
        document.getElementById('qa-report')!.textContent=JSON.stringify(result);
    }catch(error){
        document.body.dataset.cardImportVisualReady='false';
        document.getElementById('qa-report')!.textContent=String(error instanceof Error?error.stack:error);
    }
}
setTimeout(()=>{void run()},250);
