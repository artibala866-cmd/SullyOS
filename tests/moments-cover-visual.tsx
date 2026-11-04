import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import MomentsCover from '../components/chat/MomentsCover';
import {MomentsTimeline} from '../components/chat/MomentsTimeline';
import type {CharacterMoment} from '../utils/characterPhoneMoments';
const requested=new URLSearchParams(location.search).get('view')||'collapsed';
const posts=[{id:'m1',authorId:'qa-char',text:'二十二岁 有长寿面有蛋糕 还有全世界最神的大王亲手改的专属立绘 爽飞了',createdAt:Date.UTC(2026,10,1,7,19,13),comments:[],likes:[],imageUrls:[]} as unknown as CharacterMoment];
function Screen(){
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{
   const first=setTimeout(()=>{if(requested==='expanded')document.querySelector<HTMLButtonElement>('[data-testid="moments-cover-background"]')?.click();},200);
   const second=setTimeout(()=>{
     const cover=document.querySelector<HTMLElement>('[data-moments-cover]')!;
     const main=document.querySelector<HTMLElement>('main')!;
     const picker=document.querySelector<HTMLButtonElement>('[data-testid="moments-cover-picker"]')!;
     const rect=cover?.getBoundingClientRect(),btn=picker?.getBoundingClientRect(),open=requested==='expanded';
     let chosen=false;
     if(open&&picker){const input=document.querySelector<HTMLInputElement>('input[type=file]')!;input.click=()=>{chosen=true};picker.click();}
     const ok=!!(rect&&btn&&main&&(open?expanded&&rect.height>main.clientHeight*.72&&!picker.disabled&&chosen:!expanded&&Math.abs(rect.height-256)<2&&picker.disabled));
     document.body.dataset.ready=String(ok);
     document.querySelector('output')!.textContent=JSON.stringify({ok,requested,expanded,coverHeight:Math.round(rect?.height||0),mainHeight:main?.clientHeight,pickerDisabled:picker?.disabled,pickerClicked:chosen});
   },1200);
   return()=>{clearTimeout(first);clearTimeout(second)};
 },[expanded]);
 return <div style={{height:'100%',background:'#ededed',display:'flex',flexDirection:'column'}}>
   <div style={{height:34,flexShrink:0,padding:'7px 18px',fontSize:13}}>13:50 <span style={{float:'right'}}>4G ▮▮▮ 35%</span></div>
   {!expanded&&<header style={{height:56,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 18px',background:'#ededed'}}><span style={{fontSize:26}}>‹</span><strong style={{fontSize:21}}>朋友圈</strong><span style={{width:22}}/></header>}
   <main style={{flex:1,minHeight:0,position:'relative',overflowY:'auto',background:'#fff'}}>
     <MomentsCover name="宝宝狗" cover="" avatar="" expanded={expanded} onExpandedChange={setExpanded} onSelectCover={()=>{}} onRestoreDefault={()=>{}}/>
     <div style={{height:44}}/><MomentsTimeline name="宝宝狗" characterId="qa-char" posts={posts} contacts={[]}/>
   </main>
   <footer style={{height:48,flexShrink:0,background:'#f7f7f7',borderTop:'1px solid #ddd',textAlign:'center',fontSize:24,paddingTop:8}}>⌂</footer>
 </div>
}
createRoot(document.getElementById('root')!).render(<Screen/>);
