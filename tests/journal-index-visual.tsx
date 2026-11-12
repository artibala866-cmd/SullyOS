import React from 'react';
import {createRoot} from 'react-dom/client';
import JournalApp from '../apps/JournalApp';
import {OSPreviewProvider} from '../context/OSContext';
import {DB} from '../utils/db';

// Render the real JournalApp with inert, fictional storage fixtures.
const scene=new URLSearchParams(location.search).get('scene')||'two';
const avatar='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f4f4f4"/><circle cx="50" cy="46" r="25" fill="#272727"/><path d="M10 92 Q24 67 50 70 Q80 67 90 92" fill="#333"/><path d="M25 44 33 19 50 36 60 14 79 46 70 34 66 58 47 30 35 58Z" fill="#161616"/></svg>');
const character={id:'journal-visual-role',name:scene==='long'?'周树生·超长角色名字测试测试测试':'周树生',avatar,systemPrompt:''};
const textA='写日记的话实在是有一点晚了，可是今天发生的事情让我忍不住想再多写几句。';
const textB='今天真的好开心呀。跟周树生一起慢慢走在回家的路上，连晚风都觉得很温柔。';
const entry=(date:string,text:string,reply=true)=>({id:'visual-'+date,charId:character.id,date,userPage:{text,paperStyle:'plain',stickers:[]},charPage:reply?{text:'我也记得这一天。',paperStyle:'plain',stickers:[]}:undefined,chatCardMessageId:reply?123:undefined,timestamp:Date.now(),isArchived:false});
const entries=scene==='empty'?[]:scene==='many'?Array.from({length:24},(_,i)=>{const date=new Date(2026,9,14-i);return entry([date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'),i%2?textA:textB,Boolean(i%2));}):[entry('2026-10-14',textA),entry('2026-10-13',textB)];
(DB as any).getDiariesByCharId=async()=>entries;
(DB as any).getJournalStickers=async()=>[];
const previewOS={closeApp:()=>{},characters:[character],activeCharacterId:character.id,apiConfig:{},addToast:()=>{},userProfile:{name:'我'},updateCharacter:()=>{},memoryPalaceConfig:{},characterGroups:[],theme:{journalAppearance:{preset:'original',customCss:''}},updateTheme:async()=>{},openApp:()=>{}};
createRoot(document.getElementById('root')!).render(<OSPreviewProvider value={previewOS as any}><JournalApp/></OSPreviewProvider>);
const started=Date.now();
const ready=()=> {
 const calendar=document.querySelector<HTMLElement>('.sully-journal-calendar');
 const rowCount=document.querySelectorAll('.sully-journal-entry').length;
 if(!calendar||rowCount!==entries.length){
   if(Date.now()-started>15000)throw Error('Journal real-component fixture did not render the requested entries');
   setTimeout(ready,80);return;
 }
 const root=document.createElement('output');
 root.dataset.journalVisualReady='true';
 root.dataset.scene=scene;
 root.dataset.count=String(rowCount);
 root.dataset.monthCount=String(document.querySelectorAll('.sully-journal-month-heading').length);
 root.dataset.fullHeight=String(calendar.getBoundingClientRect().height >= innerHeight-27);
 root.dataset.whiteBackground=String(getComputedStyle(document.querySelector('.sully-journal-calendar-list')!).backgroundColor==='rgb(255, 255, 255)');
 root.dataset.noHorizontalOverflow=String(document.documentElement.scrollWidth<=innerWidth+1);
 root.dataset.hasPenButton=String(!!document.querySelector('.sully-journal-new-entry svg'));
 root.dataset.hasCardShadow=String(getComputedStyle(document.querySelector('.sully-journal-calendar-sheet')!).boxShadow!=='none');
 document.body.appendChild(root);
};
ready();
