/** Actual UserApp import control and confirmation dialog in Chromium, not a mock layout. */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import UserApp from '../apps/UserApp';
import { makeImportFixturePdf } from './import-fixture-pdf';
import { OSPreviewProvider } from '../context/OSContext';
import { DB } from '../utils/db';

const source=new URLSearchParams(location.search).get('source')||'user-profile';
const observed:string[]=[];
window.addEventListener('error',e=>observed.push(e.message));
window.addEventListener('unhandledrejection',e=>observed.push(String(e.reason)));
const imported='从文件导入的经历。\n我喜欢旅行和画画。';
const InitialBio='原本的个人资料不能被意外覆盖。';
const initialProfile={name:'测试档案',avatar:'',bio:InitialBio, imageAppearance:'我自己写的生图外貌', imageLockEnabled:false, perCharAvatars:{'test-role':'manual-avatar-ref'}};
const isReloaded=source==='user-profile-persist' &&
    sessionStorage.getItem('qa-doc-import-reloaded')==='1';
if (!isReloaded) await DB.saveUserProfile(initialProfile);
const initial= isReloaded ? (await DB.getUserProfile()) || initialProfile : initialProfile;
let failNextSave=source==='user-profile-failure';
let writeCount=0;
const Preview=()=>{
    const [profile,setProfile]=useState(initial);
    const profileRef=useRef(initial);
    const context={
        closeApp:()=>{},
        userProfile:profile,
        characters:[],
        addToast:(message:string)=>{(window as any).__userImportToast=message},
        updateUserProfile:async(update:any)=>{
            const patch=typeof update==='function'?update(profileRef.current):update;
            const next={...profileRef.current,...patch};
            profileRef.current=next;
            setProfile(next);
            (window as any).__savedUserBio=next.bio;
            if (failNextSave) {
                failNextSave=false;
                throw new Error('qa-disk-full');
            }
            writeCount++;
            await DB.saveUserProfile(next);
        },
        theme:{},
    } as any;
    return <OSPreviewProvider value={context}><UserApp/></OSPreviewProvider>;
};
createRoot(document.getElementById('root')!).render(<Preview/>);
async function waitFor<T>(fn:()=>T,what:string):Promise<T>{
    for(let i=0;i<160;i++){
        const result=fn();
        if(result)return result;
        await new Promise(r=>setTimeout(r,80));
    }
    throw Error('Timeout: '+what);
}
async function readSavedBio(expected:string):Promise<boolean>{
    for(let i=0;i<110;i++){
        if((await DB.getUserProfile())?.bio===expected)return true;
        await new Promise(r=>setTimeout(r,40));
    }
    return false;
}
const mark=(pass:boolean,report:object)=>{
    document.body.dataset.cardImportVisualReady=String(pass);
    document.getElementById('qa-report')!.textContent=JSON.stringify(report);
};
async function run(){
    try{
        const area=await waitFor(
            ()=>document.querySelector<HTMLTextAreaElement>('textarea[aria-label="关于我 / 设定"]'),
            'profile textarea',
        );
        if(isReloaded){
            area.scrollIntoView({block:'center'});
            const stored=await DB.getUserProfile();
            const expected=InitialBio+'\n\n'+imported;
            const pass=area.value===expected&&stored?.bio===expected &&
                stored?.imageAppearance===initialProfile.imageAppearance &&
                stored?.perCharAvatars?.['test-role']==='manual-avatar-ref';
            sessionStorage.removeItem('qa-doc-import-reloaded');
            mark(pass,{source,afterReload:true,persisted:true,displayedBio:area.value,
                noOverflow:document.documentElement.scrollWidth<=innerWidth+2,
                errors:observed});
            return;
        }
        const trigger=await waitFor(
            ()=>document.querySelector<HTMLButtonElement>('button[aria-label="导入个人设定文件"]'),
            'user profile import button',
        );
        trigger.scrollIntoView({block:'center'});
        await new Promise(r=>setTimeout(r,100));
        const input=document.querySelector<HTMLInputElement>(
            'input[aria-label="选择 TXT Word PDF 个人设定文件"]',
        )!;
        if(!input||!input.accept.includes('.pdf')||!input.accept.includes('.docx'))
            throw Error('UserApp input formats missing');
        const file=source==='user-profile-pdf'
            ?makeImportFixturePdf('PDF USER PROFILE TEXT','我的PDF档案.pdf')
            :new File([imported],'我的真实资料.txt',{type:'text/plain'});
        const upload=()=>{
            const transfer=new DataTransfer();
            transfer.items.add(file);
            input.files=transfer.files;
            input.dispatchEvent(new Event('change',{bubbles:true}));
        };
        upload();
        const dialog=await waitFor(
            ()=>document.querySelector<HTMLElement>('[role="dialog"][aria-label="导入个人设定"]'),
            'import confirmation',
        );
        const confirm=[...dialog.querySelectorAll('button')].find(x=>
            x.textContent?.includes('确认导入')) as HTMLButtonElement|undefined;
        const append=dialog.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
        const replace=[...dialog.querySelectorAll('button')].find(x=>
            x.textContent?.trim()==='替换') as HTMLButtonElement|undefined;
        if(!confirm||!append||!replace)throw Error('Missing real append/replace/confirm controls');
        const primaryBackground=getComputedStyle(confirm).backgroundColor;
        const selectedBackground=getComputedStyle(append).backgroundColor;
        const unselectedBackground=getComputedStyle(replace).backgroundColor;
        if(['transparent','rgba(0, 0, 0, 0)'].includes(primaryBackground)||
            primaryBackground===getComputedStyle(dialog).backgroundColor)
            throw Error('Confirm button visually invisible');
        if(selectedBackground===unselectedBackground)
            throw Error('Append/replace buttons have identical styling');
        const bounds=confirm.getBoundingClientRect();
        if(bounds.height<36||bounds.bottom>innerHeight+1)
            throw Error('Confirm button clipped by viewport');
        if(area.value!==InitialBio)throw Error('Preview changed saved bio without confirmation');
        const sourcePreviewOk=source!=='user-profile-pdf'||
            (dialog.textContent||'').includes('PDF USER PROFILE TEXT')&&
            (dialog.textContent||'').includes('PDF · 1 页');

        const expectedAppend=InitialBio+'\n\n'+imported;
        if(source==='user-profile-replace'){
            replace.click();
            await new Promise(r=>setTimeout(r,80));
            confirm.click();
            await waitFor(()=>area.value===imported,'replacement in UI');
            if(!(await readSavedBio(imported)))
                throw Error('Replacement was not persisted');
        }else if(source==='user-profile-cancel'){
            const cancel=dialog.querySelector<HTMLButtonElement>('button[aria-label="取消导入个人设定"]');
            if(!cancel)throw Error('Missing cancel action');
            cancel.click();
            await waitFor(()=>!document.querySelector('[role="dialog"]'),'cancel closed');
            if(area.value!==InitialBio||!(await readSavedBio(InitialBio))||writeCount!==0)
                throw Error('Cancellation mutated profile');
        }else if(source==='user-profile-failure'){
            confirm.click();
            await waitFor(()=>area.value===InitialBio&&
                String((window as any).__userImportToast).includes('qa-disk-full'),
                'failed save UI rollback');
            if(!(await readSavedBio(InitialBio)))
                throw Error('Failed save mutated saved profile');
            if(!document.querySelector('[role="dialog"]'))
                throw Error('Failed import closed the retry dialog');
        }else if(['user-profile-saved','user-profile-duplicate','user-profile-persist'].includes(source)){
            confirm.click();
            await waitFor(()=>area.value===expectedAppend,'appended text');
            if(!(await readSavedBio(expectedAppend)))
                throw Error('Append was not durably saved');
            if(document.querySelector('[role="dialog"]'))throw Error('Success did not close dialog');
            if(source==='user-profile-persist'){
                sessionStorage.setItem('qa-doc-import-reloaded','1');
                location.reload();
                return;
            }
            if(source==='user-profile-duplicate'){
                upload();
                const repeated=await waitFor(
                    ()=>document.querySelector<HTMLElement>('[role="dialog"][aria-label="导入个人设定"]'),
                    'repeat import dialog');
                const apply=[...repeated.querySelectorAll('button')].find(x=>
                    x.textContent?.includes('确认导入')) as HTMLButtonElement;
                apply.click();
                await waitFor(()=>!document.querySelector('[role="dialog"]'),'repeat import completed');
                if(writeCount!==1||!(await readSavedBio(expectedAppend)))
                    throw Error('Repeat identical import duplicated biography or unnecessarily wrote DB');
            }
        }
        const value=area.value;
        const stored=await DB.getUserProfile();
        const previewOnly=['user-profile','user-profile-pdf','user-profile-cancel','user-profile-failure'].includes(source);
        const expected=source==='user-profile-replace'?imported:
            previewOnly?InitialBio:expectedAppend;
        const dialogExpected=['user-profile','user-profile-pdf','user-profile-failure'].includes(source);
        const actualDialog=!!document.querySelector('[role="dialog"]');
        const buttonBox=trigger.getBoundingClientRect();
        const report={
            source,viewport:[innerWidth,innerHeight],
            contentCorrect:value===expected,storedCorrect:stored?.bio===expected,
            originalNameUntouched:stored?.name==='测试档案',
            independentFieldsPreserved:stored?.imageAppearance===initialProfile.imageAppearance &&
                stored?.perCharAvatars?.['test-role']==='manual-avatar-ref',
            dialogCorrect:actualDialog===dialogExpected,
            noOverflow:document.documentElement.scrollWidth<=innerWidth+2,
            buttonVisible:buttonBox.width>50&&buttonBox.right<=innerWidth,
            appendDefault:append.textContent?.trim()==='追加',
            pdfParsed:sourcePreviewOk,importWriteCount:writeCount,
            fileFormats:input.accept,errors:observed,
        };
        const pass=report.contentCorrect&&report.storedCorrect&&report.originalNameUntouched&&report.independentFieldsPreserved&&
            report.dialogCorrect&&report.noOverflow&&report.buttonVisible&&
            report.appendDefault&&report.pdfParsed&&!observed.length;
        mark(pass,report);
    }catch(error){
        mark(false,{source,error:String(error instanceof Error?error.stack:error)});
    }
}
void run();
