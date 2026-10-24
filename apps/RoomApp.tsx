import React,{useEffect,useState,Suspense} from 'react';
import {useOS} from '../context/OSContext';
import {AppID} from '../types';
import {roomLaunch} from '../utils/roomLaunch';
import {useDreamSim,dreamSimStore} from '../utils/dreamSimStore';
import DreamTheater from './DreamTheater';
import {CharacterGroupFilterBar,filterCharactersByGroup,GROUP_FILTER_ALL} from '../components/character/CharacterGroupFilter';
import TokenImg from '../components/os/TokenImg';
import {MoonStars,ArrowLeft} from '@phosphor-icons/react';

const Home3DView=React.lazy(()=>import('./room3d/Home3DSetupEntry'));

/** The original hand-drawn 2D room and world-home screens are intentionally
 * not imported. Dream Theater is retained as a standalone 3D-home feature. */
const RoomApp:React.FC=()=>{
 const {activeApp,closeApp,characters,characterGroups,setActiveCharacterId,updateCharacter,userProfile}=useOS();
 const intent=roomLaunch.peek();
 const [selected,setSelected]=useState<string|null>(()=>intent?.charId||null);
 const [dreamOpen,setDreamOpen]=useState(()=>!!intent?.openDream);
 const [dreamOwner,setDreamOwner]=useState<string|null>(()=>intent?.openDream?intent.charId??null:null);
 const [group,setGroup]=useState(GROUP_FILTER_ALL);
 const dream=useDreamSim();
 useEffect(()=>{
  const apply=()=>{
   const next=roomLaunch.consume();
   if(!next)return;
   if(next.charId){setSelected(next.charId);setActiveCharacterId(next.charId);}
   if(next.openDream){setDreamOwner(next.charId??null);setDreamOpen(true);}else{setDreamOpen(false);setDreamOwner(null);}
  };
  apply();
  return roomLaunch.subscribe(apply);
 },[setActiveCharacterId]);
 useEffect(()=>{
  if(!dream.deepLink||dream.status==='idle')return;
  setSelected(dream.charId);setActiveCharacterId(dream.charId);
  setDreamOwner(dream.charId);setDreamOpen(true);dreamSimStore.clearDeepLink();
 },[dream.deepLink,dream.status,dream.status==='idle'?null:dream.charId,setActiveCharacterId]);
 const char=characters.find(c=>c.id===selected);
 const dreamChar=characters.find(c=>c.id===dreamOwner)??char;
 const residents=char?[...(userProfile.vrState?.chibi?.state?[{id:'user',label:userProfile.name||'你',state:userProfile.vrState.chibi.state}]:[]),...characters.filter(c=>c.id!==char.id&&(c.chibiStudio?.home3D?.state||c.chibiStudio?.room?.state||c.chibiStudio?.vr?.state)).map(c=>({id:c.id,label:c.name,avatar:c.avatar,state:c.chibiStudio?.home3D?.state??c.chibiStudio?.room?.state??c.chibiStudio?.vr?.state,hair:c.chibiStudio?.home3D?.hair}))]:[];
 return <div className="relative h-full w-full overflow-hidden bg-gradient-to-b from-neutral-100 to-neutral-300 text-neutral-900">
  {char?<Suspense fallback={<div className="grid h-full place-items-center text-sm">正在打开 3D 家园…</div>}>
   <Home3DView key={char.id} suspended={activeApp!==AppID.Room||dreamOpen} character={char}
    onDefinitionChange={value=>updateCharacter(char.id,{homeDefinition:value})}
    residents={residents} value={char.home3D} onChange={value=>updateCharacter(char.id,{home3D:value})}
    onBack={()=>{setDreamOpen(false);setSelected(null);}}/>
  </Suspense>:<div className="flex h-full flex-col px-5 py-6">
   <div className="flex items-center gap-3"><button aria-label="返回桌面" onClick={closeApp}><ArrowLeft size={22}/></button><h1 className="text-lg font-semibold">3D 家园</h1></div>
   <p className="mt-2 text-sm text-neutral-500">选择角色，进入 3D 家园。</p>
   <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={group} onChange={setGroup} className="mt-5"/>
   <div className="mt-5 grid grid-cols-2 gap-3 overflow-y-auto pb-8">
    {filterCharactersByGroup(characters,characterGroups,group).map(c=><button key={c.id} onClick={()=>{setSelected(c.id);setActiveCharacterId(c.id);}} className="flex flex-col items-center gap-3 rounded-2xl bg-white/75 p-5 text-sm shadow-sm">
     <TokenImg value={c.avatar} className="h-16 w-16 rounded-full object-cover"/><span>{c.name}</span>
    </button>)}
   </div>
  </div>}
  {char&&!dreamOpen&&<button type="button" onClick={()=>{setDreamOwner(char.id);setDreamOpen(true);}} aria-label="查看梦境" title="梦境" className="absolute right-4 top-[174px] z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/80 bg-white/80 text-neutral-700 shadow-[0_4px_18px_rgba(0,0,0,0.10)] backdrop-blur-xl transition-transform active:scale-95" style={{touchAction:"manipulation"}}><MoonStars size={23} weight="thin"/></button>}
  {dreamOpen&&dreamChar&&<div className="absolute inset-0 z-50"><DreamTheater char={dreamChar} onExit={()=>{setDreamOpen(false);setDreamOwner(null);}}/></div>}
 </div>;
};
export default RoomApp;
