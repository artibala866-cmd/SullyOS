import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import MusicApp from '../apps/MusicApp';
import {MusicPreviewProvider} from '../context/MusicContext';
import {OSPreviewProvider} from '../context/OSContext';
import {DB} from '../utils/db';
import {createDateBgmList,renameDateBgmList,deleteDateBgmList,bindDateBgmCharacter,addDateBgmSong,removeDateBgmSong,moveDateBgmSong} from '../utils/dateBgm';
import type {GuestMusicLibrary} from '../utils/musicLibrary';
import type {Song} from '../context/MusicContext';

const scenario = new URLSearchParams(location.search).get('scenario') || 'filled';
const mkSong=(id:number,name:string):Song=>({id,source:'netease',name,artists:'音乐人',album:'',albumPic:'',duration:180,fee:0});
const tracks=[mkSong(1,'夜色'),mkSong(2,'雨声'),mkSong(3,'初见')];
const people=[{id:'meet-one',name:'角色甲',avatar:''},{id:'meet-two',name:'角色乙',avatar:''},{id:'meet-three',name:'角色丙',avatar:''}] as any[];
const base: GuestMusicLibrary={likes:tracks,playlists:[],history:[],dateBgmPlaylists:[]};
const makeLibrary=()=>{
  if(scenario==='empty'||scenario==='create')return base;
  let result: GuestMusicLibrary=base;
  for(let n=0;n<(scenario==='many'?6:2);n++){
    const id='bgm-'+n;
    result=createDateBgmList(result,['夜晚','日常','雨天','散步','工作','清晨'][n],id,n+1)!;
    result=addDateBgmSong(result,id,tracks[n%tracks.length])!;
    if(n===0)result=bindDateBgmCharacter(result,id,'meet-one',true)!;
  }
  return result;
};
let snapshot=makeLibrary();
const os={
  closeApp:()=>{},addToast:()=>{},characters:people,userProfile:{name:'我'},
} as any;
DB.getMessagesByCharId=async()=>[] as any;

function Harness(){
  const [library,setLibrary]=useState<GuestMusicLibrary>(snapshot);
  const modify=(update:(current:GuestMusicLibrary)=>GuestMusicLibrary|null)=>{
    setLibrary(old=>{const result=update(old);if(result){snapshot=result;return result;}return old;});
    return true;
  };
  const music={
    cfg:{cookie:'',workerUrl:'',quality:'standard'},setCfg:()=>{},effectiveWorkerUrl:'',
    current:null,playing:false,queue:[],idx:-1,progress:0,duration:0,loadingSong:false,
    actualQualityLabel:'',lyricMessage:'',lyric:[],tlyric:[],activeLyricIdx:-1,
    playSong:async()=>{},togglePlay:()=>{},nextSong:()=>{},prevSong:()=>{},seek:()=>{},
    liked:false,toggleLike:async()=>{},setToastHandler:()=>{},toast:()=>{},
    listeningTogetherWith:[],listeningStartedAt:{},listeningInvites:{},
    inviteListeningPartner:async()=>false,cancelListeningInvite:async()=>false,
    refreshListeningInvite:async()=>{},respondListeningInvite:()=>{},
    answerIncomingListeningInvite:async()=> 'stale',removeListeningPartner:()=>{},
    localAlbumSongs:[],addLocalSong:()=>{},removeLocalSong:()=>{},
    library,toggleLocalLike:()=>true,createPlaylist:()=>false,createPlaylistWithSong:()=>false,
    renamePlaylist:()=>false,deletePlaylist:()=>false,addSongToPlaylist:()=>false,
    removeSongFromPlaylist:()=>{},movePlaylistSong:()=>{},
    createDateBgmPlaylist:(name:string)=>modify(old=>createDateBgmList(old,name,'new-'+Date.now(),Date.now())),
    renameDateBgmPlaylist:(id:string,name:string)=>modify(old=>renameDateBgmList(old,id,name)),
    deleteDateBgmPlaylist:(id:string)=>modify(old=>deleteDateBgmList(old,id)),
    bindDateBgmCharacter:(id:string,charId:string,enabled:boolean)=>modify(old=>bindDateBgmCharacter(old,id,charId,enabled)),
    addSongToDateBgm:(id:string,song:Song)=>modify(old=>addDateBgmSong(old,id,song)),
    removeSongFromDateBgm:(id:string,key:string)=>modify(old=>removeDateBgmSong(old,id,key)),
    moveDateBgmTrack:(id:string,from:number,to:number)=>modify(old=>moveDateBgmSong(old,id,from,to)),
    addToQueue:()=>{},moveQueueSong:()=>{},removeQueueSong:()=>{},clearUpcomingQueue:()=>{},
    playMode:'loop',setPlayMode:()=>{},regeneratingId:null,regeneratingStatus:'',
    profile:null,refreshProfile:async()=>{},
    listeningInvites:{},lastListeningEnd:null,
  } as any;
  return <OSPreviewProvider value={os}><MusicPreviewProvider value={music}><MusicApp/></MusicPreviewProvider></OSPreviewProvider>;
}

const host=document.getElementById('visual')!;
createRoot(host).render(<Harness/>);
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const click=(element:HTMLElement|null,label:string)=>{if(!element)throw Error('missing '+label);element.click();};
const setValue=(input:HTMLInputElement,value:string)=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
};
const findButton=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.includes(text))||null;
const openPanel=async()=>{
  for(let i=0;i<35&&!host.querySelector('[role="tab"]');i++)await wait(120);
  const tab=[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(x=>x.textContent?.trim()==='见面 BGM')||null;
  click(tab,'见面 BGM tab');
  await wait(220);
};
const run=async()=>{
  await openPanel();
  const first=host.querySelector<HTMLButtonElement>('button[aria-label^="配置见面 BGM 歌单"]');
  if(scenario==='create'){
    const input=host.querySelector<HTMLInputElement>('input[aria-label="新建见面 BGM 歌单名称"]');
    if(!input)throw Error('missing name input');
    setValue(input,'我的专属 BGM');
    await wait(100);
    click(host.querySelector<HTMLButtonElement>('button[aria-label="创建见面 BGM 歌单"]'),'create');
    await wait(220);
  }
  if(['filled','many','create'].includes(scenario)){
    click(host.querySelector<HTMLButtonElement>('button[aria-label^="配置见面 BGM 歌单"]'),'playlist card');
    await wait(180);
  }
  if(scenario==='create'){
    click(host.querySelector<HTMLInputElement>('input[type="checkbox"]'),'bind character');
    await wait(160);
    click(findButton('添加音乐'),'add tracks');
    await wait(120);
    click(findButton('夜色'),'choose song');
    await wait(160);
  }
  // Capture the actual tab scroll position showing the selected playlist configuration.
  const expanded=host.querySelector<HTMLElement>('section');
  if(expanded && scenario!=='empty'){
    expanded.scrollIntoView({block:'start',behavior:'instant'});
    await wait(130);
  }
  const panel=host.querySelector<HTMLElement>('[data-music-date-bgm]');
  const cards=host.querySelectorAll('button[aria-label^="配置见面 BGM 歌单"]');
  const checked=host.querySelectorAll('input[type="checkbox"]:checked');
  const addSection=host.querySelector('input[aria-label="筛选可加入见面 BGM 的歌曲"]');
  const box=host.getBoundingClientRect();
  const rect=panel?.getBoundingClientRect();
  const overflow=host.scrollWidth>host.clientWidth+1;
  const report={
    scenario,hasPanel:!!panel,tabActive:host.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
    cards:cards.length,expanded:!!expanded,checked:checked.length,
    songCount:snapshot.dateBgmPlaylists?.[0]?.songs.length||0,
    boundFirst:snapshot.dateBgmPlaylists?.[0]?.characterIds||[],
    addSection:!!addSection,overflow,
    box:[Math.round(box.width),Math.round(box.height)],
    panel:[Math.round(rect?.left||0),Math.round(rect?.width||0)],
    text:panel?.textContent?.slice(0,350)||'',
  };
  const pass=report.hasPanel&&report.tabActive==='见面 BGM'&&!overflow
    &&(scenario==='empty'?report.cards===0&&report.text.includes('还没有见面专属歌单')
      :scenario==='create'?report.cards===1&&report.boundFirst.includes('meet-one')&&report.songCount===1
      :scenario==='many'?report.cards===6&&report.expanded:report.cards===2&&report.expanded);
  document.body.dataset.meetBgmReady=String(pass);
  const output=document.createElement('output');output.id='meet-bgm-visual-report';output.hidden=true;
  output.textContent=JSON.stringify(report);document.body.append(output);
};
void run().catch(error=>{
  document.body.dataset.meetBgmReady='false';
  const output=document.createElement('output');output.id='meet-bgm-visual-error';
  output.textContent=String(error);document.body.append(output);
});
