import React, {useEffect,useState} from 'react';
import {
  ArrowLeft, House, MagnifyingGlass, Bell, User, Compass, Heart,
  ChatCircleDots, Images, Play, BookmarkSimple, GridFour, ClockCounterClockwise,
  UsersThree, DotsThree, VideoCamera, BookOpen, EnvelopeSimple, Books, MusicNotes,
} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';
import CharacterPhoneSocialContentPage from './CharacterPhoneSocialContentPage';
import CharacterPhoneMoreApps from './CharacterPhoneMoreApps';
import CharacterPhoneNetease from './CharacterPhoneNetease';
import type {CharacterProfile,UserProfile,GroupProfile,RealtimeConfig} from '../../types';
import {
  CHARACTER_PHONE_SOCIAL_APP_INFO,
  type CharacterPhoneSocialAppId,
} from '../../utils/characterPhoneAppInstall';

type Tab = {id:string;label:string;Icon:React.ComponentType<{size?:number;weight?:any}>};
const X_TABS:Tab[]=[
  {id:'for-you',label:'为你推荐',Icon:House},{id:'following',label:'正在关注',Icon:UsersThree},
  {id:'search',label:'搜索',Icon:MagnifyingGlass},{id:'notifications',label:'通知',Icon:Bell},
  {id:'profile',label:'我的',Icon:User},
];
const BILI_TABS:Tab[]=[
  {id:'home',label:'首页',Icon:House},{id:'dynamic',label:'动态',Icon:Compass},
  {id:'history',label:'历史',Icon:ClockCounterClockwise},
  {id:'favorites',label:'收藏',Icon:BookmarkSimple},{id:'profile',label:'我的',Icon:User},
];
const WEIBO_TABS:Tab[]=[
  {id:'home',label:'首页',Icon:House},{id:'hot',label:'热搜',Icon:MagnifyingGlass},
  {id:'messages',label:'消息',Icon:ChatCircleDots},{id:'profile',label:'我的',Icon:User},
];
const IG_TABS:Tab[]=[
  {id:'home',label:'首页',Icon:House},{id:'explore',label:'探索',Icon:Compass},
  {id:'reels',label:'Reels',Icon:VideoCamera},{id:'likes',label:'动态',Icon:Heart},
  {id:'profile',label:'主页',Icon:User},
];
const ALL_TABS:Partial<Record<CharacterPhoneSocialAppId,Tab[]>>={
  x:X_TABS,bilibili:BILI_TABS,weibo:WEIBO_TABS,instagram:IG_TABS,
};
function SocialLogo({appId,size='large'}:{appId:CharacterPhoneSocialAppId;size?:'small'|'large'}) {
  return <span aria-hidden="true" className={'inline-flex shrink-0 items-center justify-center font-semibold tracking-tight '+
    (size==='small'?'h-7 w-7 text-lg':'h-12 w-12 text-2xl')+
    (appId==='instagram'?' rounded-[15px] border border-[#b8b8b8]':'')}>
    {appId==='x'?'𝕏':appId==='bilibili'?'b':appId==='weibo'?'◎':'▢'}
  </span>;
}
export function CharacterPhoneSocialIcon({appId}:{appId:CharacterPhoneSocialAppId}) {
  if(appId==='douban'||appId==='douyin'||appId==='email'||appId==='jinjiang'||appId==='netease'){
    const Icon={douban:BookOpen,douyin:VideoCamera,email:EnvelopeSimple,jinjiang:Books,netease:MusicNotes}[appId];
    return <div className="flex h-14 w-14 items-center justify-center rounded-[17px] border border-white/90 bg-gradient-to-br from-white via-[#f9f9f9] to-[#e6e6e6] text-[#454545] shadow-[0_5px_14px_rgba(0,0,0,.09),inset_0_1px_2px_white]">
      <Icon size={30} weight="regular"/>
    </div>;
  }
  return <div className={'flex h-14 w-14 items-center justify-center rounded-[17px] border shadow-sm '+
    (appId==='x'?'border-[#252525] bg-[#111] text-white':
     appId==='bilibili'?'border-[#dedee1] bg-[#f8f8fa] text-[#24242a]':
     appId==='weibo'?'border-[#dadada] bg-[#ececec] text-[#222]':
     'border-[#d6d6d6] bg-white text-[#242424]')}>
    {appId==='x'?<span className="text-3xl font-medium">𝕏</span>:
     appId==='bilibili'?<span className="text-[20px] font-extrabold tracking-tight">bili</span>:
     appId==='weibo'?<span className="text-[36px] font-normal leading-none">◎</span>:
     <span className="flex h-8 w-8 items-center justify-center rounded-[11px] border-[2.5px] border-current"><span className="h-3 w-3 rounded-full border-[2px] border-current"/></span>}
  </div>;
}
function EmptySection({title,description,icon='feed'}:{
  title:string;description:string;icon?:'feed'|'search'|'people'|'grid';
}) {
  const Icon=icon==='search'?MagnifyingGlass:icon==='people'?UsersThree:icon==='grid'?GridFour:Images;
  return <div className="flex flex-1 flex-col items-center justify-center px-9 py-12 text-center text-[#666]">
    <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[26px] border border-[#e2e2e2] bg-gradient-to-br from-white to-[#f1f1f1] text-[#999]">
      <Icon size={32} weight="thin"/>
    </div>
    <strong className="text-[15px] font-semibold text-[#303030]">{title}</strong>
    <p className="mt-2 max-w-[270px] text-xs leading-6 text-[#888]">{description}</p>
  </div>;
}
function ProfileTop({name,avatar,variant}:{name:string;avatar?:string;variant:CharacterPhoneSocialAppId}) {
  return <div className="border-b border-[#ededed] bg-white px-5 pb-6 pt-5">
    <div className="flex items-center gap-4">
      <div className={'rounded-full p-0.5 '+(variant==='instagram'?'border-2 border-[#555]':'border border-[#ddd]')}>
        <PhoneAvatar src={avatar} name={name} className="h-[66px] w-[66px] rounded-full text-2xl"/>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold text-[#202020]">{name}</div>
        <div className="mt-1 truncate text-xs text-[#888]">此账号属于 Char</div>
        <div className="mt-2 text-xs text-[#aaa]">尚未生成平台资料</div>
      </div>
    </div>
    {variant==='instagram' && <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[#f1f1f1] pt-4 text-center text-xs">
      {['帖子','粉丝','关注'].map(label=><span key={label}><strong className="block text-sm text-[#333]">—</strong><span className="mt-0.5 block text-[#888]">{label}</span></span>)}
    </div>}
    <div className="mt-4 flex gap-2"><div className="flex-1 rounded-lg bg-[#f3f3f3] py-2 text-center text-xs text-[#777]">个人资料待完善</div></div>
  </div>;
}
function SocialBody({appId,tabId,name,avatar}:{appId:CharacterPhoneSocialAppId;tabId:string;name:string;avatar?:string}) {
  if(tabId==='profile')return <>
    <ProfileTop name={name} avatar={avatar} variant={appId}/>
    {appId==='instagram' && <div className="flex gap-4 overflow-x-auto border-b border-[#eee] bg-white px-5 py-5">
      {[1,2,3,4].map(i=><div key={i} className="flex shrink-0 flex-col items-center gap-2"><div className="h-14 w-14 rounded-full border border-dashed border-[#ccc] bg-[#fafafa]"/><div className="h-1.5 w-10 rounded bg-[#eee]"/></div>)}
    </div>}
    {appId==='bilibili' && <div className="mx-4 mt-4 grid grid-cols-3 gap-2">
      {['动态','收藏','观看记录'].map(label=><div key={label} className="rounded-xl border border-[#ececec] bg-white px-2 py-4 text-center text-xs text-[#777]">{label}</div>)}
    </div>}
    <EmptySection title="还没有平台记录" description="这里只是角色的个人主页框架。头像、发帖和互动数据将在后续阶段接入。" icon="grid"/>
  </>;
  if(appId==='x')return <div className="flex min-h-full flex-col bg-white">
    {tabId==='for-you'||tabId==='following'?<>
      <div className="flex items-center justify-around border-b border-[#ececec] py-3 text-[13px] font-medium">
        <span className={tabId==='for-you'?'border-b-2 border-[#333] pb-1':'text-[#888]'}>为你推荐</span>
        <span className={tabId==='following'?'border-b-2 border-[#333] pb-1':'text-[#888]'}>正在关注</span>
      </div>
      <EmptySection title="时间线尚未初始化" description="X 的关注列表与帖子生成暂未接入。之后由 Char 的兴趣和社交关系形成内容。"/>
    </>:<EmptySection title={tabId==='search'?'搜索功能待接入':'暂无通知'} description="这是 X 的页面框架，当前不会伪造搜索结果或互动。" icon={tabId==='search'?'search':'feed'}/>}
  </div>;
  if(appId==='bilibili')return <div className="flex min-h-full flex-col bg-[#f7f7f8]">
    {tabId==='home'&&<div className="border-b border-[#eee] bg-white p-4">
      <div className="flex gap-2 text-xs">{['推荐','热门','直播','番剧'].map((x,i)=><span key={x} className={'rounded-full px-3 py-1.5 '+(i===0?'bg-[#303030] text-white':'bg-[#f4f4f4] text-[#777]')}>{x}</span>)}</div>
      <div className="mt-4 aspect-[2.8/1] rounded-2xl border border-[#eee] bg-gradient-to-br from-[#eeeeef] via-white to-[#e7e7eb]"/>
    </div>}
    <EmptySection title={tabId==='favorites'?'还没有收藏视频':tabId==='history'?'还没有观看历史':tabId==='dynamic'?'暂无关注动态':'等待视频内容'} description="B站的视频、收藏、观看记录会在后续开发；这次不模拟真实播放或编造视频。" icon="grid"/>
  </div>;
  if(appId==='weibo')return <div className="flex min-h-full flex-col bg-[#f4f4f4]">
    {tabId==='hot'&&<div className="mx-3 mt-3 rounded-xl bg-white p-4">
      <div className="flex items-center justify-between"><strong className="text-[15px]">微博热搜</strong><span className="text-xs text-[#999]">暂无榜单</span></div>
      <p className="mt-2 text-xs leading-5 text-[#999]">以后这里展示角色可能浏览的动态话题，不把未抓取的热搜当成真实数据。</p>
    </div>}
    {(tabId==='home'||tabId==='messages')&&<div className="mx-3 mt-3 flex gap-2">
      {['关注','推荐'].map((item,i)=><div key={item} className={'rounded-full px-4 py-2 text-xs '+(i===0?'bg-[#303030] text-white':'bg-white text-[#777]')}>{item}</div>)}
    </div>}
    <EmptySection title={tabId==='hot'?'热搜暂未接入':tabId==='messages'?'私信与消息待接入':'微博动态尚未生成'} description="微博首页、热搜、消息和我的页面已预留位置。此阶段没有自动发博或虚构评论。"/>
  </div>;
  return <div className="flex min-h-full flex-col bg-white">
    {tabId==='home'&&<div className="border-b border-[#eee] px-4 py-3">
      <div className="flex items-center justify-between"><span className="font-serif text-[21px] italic tracking-tight text-[#202020]">Instagram</span><Heart size={23} color="#555"/></div>
      <div className="mt-4 flex gap-4 overflow-hidden">
        {[1,2,3,4].map(i=><div key={i} className="flex shrink-0 flex-col items-center gap-2"><div className="h-14 w-14 rounded-full border border-[#d5d5d5] bg-gradient-to-br from-[#eee] to-white"/><div className="h-1.5 w-9 rounded bg-[#eee]"/></div>)}
      </div>
    </div>}
    {tabId==='explore'&&<div className="grid grid-cols-3 gap-1.5 p-1.5">
      {Array.from({length:9},(_,i)=><div key={i} className="aspect-square rounded-md border border-[#f0f0f0] bg-gradient-to-br from-[#f1f1f1] to-[#fafafa]"/>)}
    </div>}
    <EmptySection title={tabId==='reels'?'Reels 尚未接入':tabId==='likes'?'暂时没有互动记录':tabId==='explore'?'探索内容待生成':'暂无照片动态'} description="Instagram 的主页、故事、探索、短视频和个人档案先完成排版，后续再生成角色真实的内容。" icon="grid"/>
  </div>;
}
/** Shell only. No fake posts, API requests, or autonomous effects are created here. */
export default function CharacterPhoneSocialApps({
  appId,ownerName,ownerAvatar,onBack,char,userProfile,groups,realtimeConfig,api,
}:{
  appId:CharacterPhoneSocialAppId;ownerName:string;ownerAvatar?:string;onBack:()=>void;
  char:CharacterProfile;userProfile:UserProfile;groups:GroupProfile[];
  realtimeConfig?:RealtimeConfig;api:{baseUrl:string;apiKey:string;model:string};
}) {
  const tabs=ALL_TABS[appId]||X_TABS;
  const [tabId,setTabId]=useState(tabs[0].id);
  useEffect(()=>{setTabId((ALL_TABS[appId]||X_TABS)[0].id);},[appId]);
  if(appId==='netease')return <CharacterPhoneNetease characterId={char.id} onBack={onBack}/>;
  if(appId==='douban'||appId==='douyin'||appId==='email'||appId==='jinjiang'){
    return <CharacterPhoneMoreApps appId={appId} ownerName={ownerName} ownerAvatar={ownerAvatar} onBack={onBack}/>;
  }
  // These two optional apps have independent content, cache and AI buttons.
  if(appId==='weibo'||appId==='instagram'){
    return <CharacterPhoneSocialContentPage appId={appId} char={char} userProfile={userProfile}
      groups={groups} realtimeConfig={realtimeConfig} api={api}
      ownerAvatar={ownerAvatar} onBack={onBack}/>;
  }
  return <section className="flex min-h-full flex-col bg-white text-[#262626]">
    <header className="sticky top-0 z-10 flex min-h-[56px] items-center justify-between border-b border-[#ededed] bg-white/95 px-4 backdrop-blur-md">
      <button type="button" onClick={onBack} aria-label="返回查手机桌面" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#f2f2f2]"><ArrowLeft size={21}/></button>
      <div className="flex items-center gap-2">
        <SocialLogo appId={appId} size="small"/>
        <strong className="text-sm font-semibold">{CHARACTER_PHONE_SOCIAL_APP_INFO[appId].label}</strong>
      </div>
      <button type="button" aria-label="切换到搜索栏目" onClick={()=>setTabId(appId==='instagram'?'explore':appId==='weibo'?'hot':appId==='bilibili'?'home':'search')}
        className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[#f2f2f2]"><MagnifyingGlass size={21}/></button>
    </header>
    <div className="flex min-h-[340px] flex-1 flex-col">
      <SocialBody appId={appId} tabId={tabId} name={ownerName} avatar={ownerAvatar}/>
    </div>
    <nav aria-label={CHARACTER_PHONE_SOCIAL_APP_INFO[appId].label+'栏目'} className="sticky bottom-0 z-10 grid shrink-0 border-t border-[#ececec] bg-white/95 py-2 backdrop-blur-md" style={{gridTemplateColumns:`repeat(${tabs.length},minmax(0,1fr))`}}>
      {tabs.map(({id,label,Icon})=><button key={id} type="button" aria-current={tabId===id?'page':undefined}
        onClick={()=>setTabId(id)} className={'flex min-w-0 flex-col items-center gap-1 px-1 py-1 text-[10px] '+(tabId===id?'font-semibold text-[#222]':'text-[#999]')}>
        <Icon size={21} weight={tabId===id?'fill':'regular'}/>
        <span className="truncate">{label}</span>
      </button>)}
    </nav>
  </section>;
}
