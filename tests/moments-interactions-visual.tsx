import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MomentsTimeline} from '../components/chat/MomentsTimeline';
import {CHARACTER_MOMENTS_CHANGED,readCharacterMoments} from '../utils/characterPhoneMoments';
import type {CharacterMoment} from '../utils/characterPhoneMoments';
import type {NpcProfile} from '../utils/characterPhoneNpcs';

const id='moments-actions-visual';
const now=Date.now();
const initial:CharacterMoment[]=[
 {id:'my-post',characterId:id,authorId:id,origin:'char',visibility:'all',
  text:'今天认真画了新立绘，终于把喜欢的细节都补齐了。',imageUrls:[],createdAt:now-7200000,
  likes:[{actorId:'user',createdAt:now-3500000},{actorId:'friend',createdAt:now-3000000}],
  comments:[
   {id:'c1',authorId:'friend',text:'配色也太好看了！',createdAt:now-2500000},
   {id:'c2',authorId:'user',text:'谢谢！这一版很满意',createdAt:now-2300000,replyToId:'c1'},
  ]},
 {id:'friend-post',characterId:id,authorId:'friend',origin:'npc',visibility:'all',
  text:'今天新拍的照片。天气很好，一切都刚刚好。',imageUrls:[],createdAt:now-86400000,
  likes:[],comments:[]},
];
localStorage.setItem('sully_character_moments_v1:'+id,JSON.stringify(initial));
const people=[{id:'friend',name:'荆棘鸟',nickname:'荆棘鸟'}] as unknown as NpcProfile[];
function Demo(){
 const [posts,setPosts]=useState<CharacterMoment[]>(initial);
 useEffect(()=>{
  const onChange=()=>setPosts(readCharacterMoments(id));
  window.addEventListener(CHARACTER_MOMENTS_CHANGED,onChange);
  return()=>window.removeEventListener(CHARACTER_MOMENTS_CHANGED,onChange);
 },[]);
 return <div className="flex h-[840px] flex-col bg-white">
   <div className="flex h-[34px] shrink-0 justify-between bg-[#ededed] px-4 pt-1 text-[13px]">
    <span>15:52</span><span>4G ▮▮▮ ▰ 50%</span>
   </div>
   <header className="flex h-[56px] shrink-0 items-center justify-between bg-[#ededed] px-5">
     <span className="text-[30px]">‹</span><strong className="text-[20px]">朋友圈</strong><span className="w-5"/>
   </header>
   <main className="min-h-0 flex-1 overflow-y-auto bg-white">
     <MomentsTimeline name="宝宝狗" characterId={id} posts={posts} contacts={people}/>
   </main>
   <footer className="h-[46px] shrink-0 border-t border-[#ddd] bg-[#f8f8f8] pt-1 text-center text-2xl">⌂</footer>
 </div>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
