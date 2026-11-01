import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {OSPreviewProvider} from '../context/OSContext';
import ChibiStudio,{ChibiShelfPanel} from '../components/character/ChibiStudio';
import {homeFigureSeed} from '../utils/homeFigureSeed';

const host=document.querySelector<HTMLElement>('#figure-root')!;
const scene=new URLSearchParams(location.search).get('scene')??'cabinet';
const existing=new URLSearchParams(location.search).get('existing')!=='0';
const portrait='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(
 '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 180"><ellipse fill="#27213a" cx="70" cy="166" rx="55" ry="8"/><circle fill="#e6d9da" cx="70" cy="72" r="46"/><path fill="#292538" d="M26 65 Q15 1 70 12 Q128 3 114 65 L99 50 L90 35 L78 58 L50 43Z"/><circle cx="53" cy="76" r="6" fill="#232337"/><circle cx="87" cy="76" r="6" fill="#232337"/><path stroke="#c88f97" stroke-width="2" fill="none" d="M63 90 Q70 96 77 90"/><path fill="#38304d" d="M44 111 H96 L109 158 H30 Z"/></svg>');
const character={
 id:'visual-3d-home',name:'演示角色',avatar:portrait,
 chibiStudio:{
  room:{state:{selected:{eyes:'obsolete-room'}}},
  vr:{state:{selected:{eyes:'obsolete-vr'}}},
  like520:{state:{selected:{eyes:'obsolete-event'}}},
  ...(existing?{home3D:{state:homeFigureSeed(undefined,false),img:portrait,hair:{layers:{},extras:[]},updatedAt:Date.now()}}:{})
 }
};
const fakeContext={characters:[character],userProfile:{name:'演示用户'},theme:{},
 updateCharacter:(id:string,update:any)=>{
  if(id!==character.id)throw Error('Wrong character received an update');
  const next=typeof update==='function'?update(character as any):update;
  Object.assign(character,next);
  const slot=character.chibiStudio.home3D;
  document.body.dataset.figureSaved=String(!!slot?.state && !!slot?.img && !!slot?.hair);
 },
 updateUserProfile:()=>{}
};
try{
 const root=createRoot(host);
 flushSync(()=>root.render(
  <OSPreviewProvider value={fakeContext as any}>
   {scene==='shelf'?<div style={{padding:'330px 20px 32px'}}><ChibiShelfPanel charId={character.id} onOpen={()=>{document.body.dataset.opened='yes';}}/></div>
    :<ChibiStudio charId={character.id} onClose={()=>{document.body.dataset.closed='yes';}}/>}
  </OSPreviewProvider>
 ));
 if(scene==='source'||scene==='editor'){
  const edit=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('重新捏')||b.textContent?.includes('捏这只'));
  flushSync(()=>edit?.click());
  if(scene==='editor'){
    const resume=[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes('继续编辑当前家园形象'));
    flushSync(()=>resume?.click());
  }
 }
 setTimeout(()=>{
  const text=document.body.textContent??'';
  const images=[...document.querySelectorAll<HTMLImageElement>('img')];
  const buttons=[...document.querySelectorAll<HTMLButtonElement>('button')];
  const all3d=scene==='editor'?(text.includes('3D 形象')&&text.includes('造型间')):scene==='source'?text.includes('3D 家园 · Q 版捏人'):text.includes('3D 家园 · Q 版形象');
  const oldAbsent=!['小小窝','特别时光','彼方','520 EVENT','同步到全部'].some(t=>text.includes(t));
  const correctCount=scene==='source'||scene==='editor'||(existing?text.includes('1/1 已上架')||scene==='cabinet':text.includes('0/1 已上架')||scene==='cabinet');
  const sourceButtons=scene==='editor'||scene!=='source'||(!!buttons.find(b=>b.textContent?.includes('从头捏一个'))&&(!existing||!!buttons.find(b=>b.textContent?.includes('继续编辑当前家园形象'))));
  const noOverflow=document.documentElement.scrollWidth<=innerWidth+2;
  const imageRendered=!existing||scene==='source'||scene==='editor'||images.some(i=>i.src.startsWith('data:image/svg+xml')&&i.complete);
  const uiInteractive=buttons.filter(b=>b.getBoundingClientRect().width>30).length>=1;
  const saveButton=buttons.find(b=>b.textContent?.includes('完成并保存'));
  const editorControls=scene!=='editor'||!!saveButton;
  const editorReady=scene!=='editor'||(!!saveButton&&!saveButton.disabled&&!text.includes('正在还原 3D 形象'));
  const frame=document.querySelector<HTMLIFrameElement>('iframe');
  const diag=scene==='editor'?{
    readyState:frame?.contentDocument?.readyState,
    iframeBody:frame?.contentDocument?.body?.textContent?.slice(0,120),
    frames:document.querySelectorAll('iframe').length,
    iframeImages:frame?.contentDocument?.querySelectorAll('.character img').length,
    iframeCharacter:!!frame?.contentDocument?.querySelector('.character'),
    error:document.body.dataset.error,
    disabled:saveButton?.disabled,
  }:undefined;
  const checks={all3d,oldAbsent,correctCount,sourceButtons,noOverflow,imageRendered,uiInteractive,editorControls,editorReady};
  const output=document.createElement('output');output.id='neural-cabinet-visual-checks';output.textContent=JSON.stringify({scene,existing,checks,diag});output.hidden=true;document.body.append(output);
  document.body.dataset.figureVisualReady=Object.values(checks).every(Boolean)?'true':'false';
 },scene==='editor'?11000:1000);
}catch(e){document.body.dataset.figureVisualReady='false';document.body.dataset.error=String(e instanceof Error?e.stack:e);}
