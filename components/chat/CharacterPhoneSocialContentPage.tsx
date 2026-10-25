import React, {useEffect,useState} from 'react';
import {ArrowLeft,SpinnerGap,Sparkle,House,MagnifyingGlass,ChatCircleDots,User,
  Heart,BookmarkSimple,GridFour,Compass,VideoCamera,PaperPlaneTilt,DotsThree} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';
import {
  SOCIAL_SNAPSHOT_CHANGED,readSocialSnapshot,generateSocialSnapshot,
  type SocialContentApp,type SocialSnapshot,type SocialPost,type SocialViewed,
} from '../../utils/characterPhoneSocialContent';
import {readCharacterPhoneInstallPlan} from '../../utils/characterPhoneAppInstall';
import type {CharacterProfile,UserProfile,GroupProfile,RealtimeConfig} from '../../types';

type Props={
  appId:SocialContentApp;char:CharacterProfile;userProfile:UserProfile;
  groups:GroupProfile[];realtimeConfig?:RealtimeConfig;
  api:{baseUrl:string;apiKey:string;model:string};ownerAvatar?:string;onBack:()=>void;
};
const WEIBO_TABS=[
  {id:'home',label:'首页',Icon:House},{id:'viewed',label:'看过',Icon:MagnifyingGlass},
  {id:'replies',label:'互动',Icon:ChatCircleDots},{id:'profile',label:'我的',Icon:User},
] as const;
const INSTAGRAM_TABS=[
  {id:'home',label:'主页',Icon:House},{id:'explore',label:'探索',Icon:Compass},
  {id:'reels',label:'Reels',Icon:VideoCamera},{id:'replies',label:'互动',Icon:Heart},
  {id:'profile',label:'我的',Icon:User},
] as const;
type TabId='home'|'viewed'|'replies'|'profile'|'explore'|'reels';
const dateLabel=(v:number)=>new Date(v).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const shortHandle=(text:string)=>text.replace(/^@/,'');
function GeneratedVisual({description,style='square'}:{description?:string;style?:'square'|'portrait'|'wide'}){
  if(!description)return null;
  return <div className={'relative flex items-center justify-center overflow-hidden border border-[#eee] bg-gradient-to-br from-[#ededed] via-[#fafafa] to-[#dddddd] '+(
    style==='portrait'?'aspect-[4/5]':style==='wide'?'aspect-[16/9]':'aspect-square')}>
    <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/75 blur-2xl"/>
    <div className="absolute -bottom-12 -left-10 h-40 w-40 rounded-full bg-[#bdbdbd]/25 blur-2xl"/>
    <div className="relative mx-4 max-w-[260px] rounded-2xl border border-white/70 bg-white/65 px-4 py-3 text-center text-xs leading-6 text-[#666] shadow-sm backdrop-blur">
      <div className="mb-2 text-[10px] uppercase tracking-[.12em] text-[#999]">画面描述</div>
      {description}
    </div>
  </div>;
}
function Person({name,avatar,sub}:{name:string;avatar?:string;sub?:string}){
  return <div className="flex min-w-0 items-center gap-3">
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[#ddd] bg-[#eee]">
      <PhoneAvatar src={avatar} name={name} className="h-10 w-10 rounded-full text-xs"/>
    </div>
    <div className="min-w-0 flex-1">
      <strong className="block truncate text-[13px] font-semibold text-[#242424]">{name}</strong>
      {sub&&<span className="block truncate text-[11px] text-[#9c9c9c]">{sub}</span>}
    </div>
  </div>;
}
function Comments({post,ownerName}:{post:SocialPost;ownerName:string}){
  if(!post.comments.length)return <p className="mt-3 text-[11px] text-[#a0a0a0]">暂无评论</p>;
  return <div className="mt-3 space-y-2.5 border-t border-[#f0f0f0] pt-3">
    {post.comments.map(c=><div key={c.id} className="text-xs leading-5">
      <div className="flex gap-2"><b className="shrink-0 text-[#444]">{c.authorName}</b><span className="min-w-0 break-words text-[#696969]">{c.content}</span></div>
      {c.charReply&&<div className="ml-3 mt-1 border-l-2 border-[#e3e3e3] pl-2 text-[#777]"><b>{ownerName}</b> 回复：{c.charReply}</div>}
    </div>)}
  </div>;
}
function WeiboPost({post,name,avatar}:{post:SocialPost;name:string;avatar?:string}){
  return <article className="mb-2 bg-white px-4 pb-4 pt-4">
    <div className="flex items-center justify-between"><Person name={name} avatar={avatar} sub="Char 的微博 · 已生成的使用记录"/><DotsThree size={20} color="#aaa"/></div>
    <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#252525]">{post.text}</p>
    {post.topic&&<div className="mt-2 text-xs text-[#555]">#{post.topic}#</div>}
    {post.visual&&<div className="mt-3 overflow-hidden rounded-xl"><GeneratedVisual description={post.visual} style="wide"/></div>}
    <div className="mt-4 flex items-center justify-around border-y border-[#f1f1f1] py-2.5 text-xs text-[#888]">
      <span className="inline-flex items-center gap-1.5"><Heart size={17}/>{post.likes}</span>
      <span className="inline-flex items-center gap-1.5"><ChatCircleDots size={17}/>{post.comments.length}</span>
      <span className="inline-flex items-center gap-1.5"><PaperPlaneTilt size={17}/>分享</span>
    </div>
    <Comments post={post} ownerName={name}/>
  </article>;
}
function InstagramPost({post,name,avatar,handle}:{post:SocialPost;name:string;avatar?:string;handle:string}){
  return <article className="mb-3 border-b border-[#efefef] bg-white pb-4">
    <div className="flex items-center justify-between px-3 py-2.5"><Person name={name} avatar={avatar} sub={'@'+shortHandle(handle)}/><DotsThree size={21}/></div>
    {post.visual?<GeneratedVisual description={post.visual} style="portrait"/>:
      <div className="aspect-[4/3] bg-gradient-to-br from-[#ededed] to-[#fafafa] p-8 text-center text-sm text-[#999]">未附照片</div>}
    <div className="flex items-center gap-4 px-4 pt-3 text-[#222]">
      <Heart size={25}/><ChatCircleDots size={24}/><PaperPlaneTilt size={24}/><span className="flex-1"/><BookmarkSimple size={23}/>
    </div>
    <div className="px-4 pt-2">
      <div className="text-xs font-semibold">{post.likes} 次赞</div>
      <p className="mt-1 text-[13px] leading-6 text-[#444]"><b className="mr-2">{shortHandle(handle)}</b>{post.text}</p>
      {post.topic&&<p className="mt-0.5 text-xs text-[#888]">#{post.topic}</p>}
      <Comments post={post} ownerName={name}/>
    </div>
  </article>;
}
function SeenCard({item,name,instagram}:{item:SocialViewed;name:string;instagram:boolean}){
  return <article className={instagram?'mb-3 border-b border-[#eee] bg-white pb-4':'mb-2 bg-white px-4 py-4'}>
    <div className={instagram?'px-4':' '}>
      <Person name={item.authorName} sub={instagram?'Char 看过的动态':'Char 浏览过的内容'}/>
      <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-[#4b4b4b]">{item.text}</p>
      {item.topic&&<span className="mt-1 block text-xs text-[#888]">#{item.topic}</span>}
    </div>
    {item.visual&&<div className={instagram?'mt-3':'mt-3 overflow-hidden rounded-xl'}><GeneratedVisual description={item.visual} style={instagram?'square':'wide'}/></div>}
    {item.charComment&&<div className={'mt-3 rounded-xl bg-[#f4f4f4] px-3 py-2 text-xs leading-5 text-[#666] '+(instagram?'mx-4':'')}>
      <b>{name} 评论：</b>{item.charComment}
    </div>}
  </article>;
}
function Profile({snapshot,name,avatar,instagram,onSelect}:{snapshot:SocialSnapshot;name:string;avatar?:string;instagram:boolean;onSelect:(id:string)=>void}){
  return <div className="min-h-full bg-white">
    <div className={instagram?'px-4 pb-5 pt-6':'bg-gradient-to-b from-[#ebebeb] to-white px-5 pb-5 pt-8'}>
      <div className="flex items-center gap-5">
        <div className="rounded-full border-2 border-[#d5d5d5] p-1"><PhoneAvatar src={avatar} name={name} className="h-[76px] w-[76px] rounded-full"/></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{name}</div>
          <div className="mt-1 truncate text-xs text-[#999]">@{shortHandle(snapshot.profile.handle)}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px] text-[#888]">
            <span><strong className="block text-sm text-[#333]">{snapshot.posts.length}</strong>发布</span>
            <span><strong className="block text-sm text-[#333]">{snapshot.viewed.length}</strong>浏览</span>
            <span><strong className="block text-sm text-[#333]">{snapshot.posts.reduce((s,p)=>s+p.comments.length,0)}</strong>互动</span>
          </div>
        </div>
      </div>
      {snapshot.profile.bio&&<p className="mt-4 whitespace-pre-wrap text-[12px] leading-5 text-[#555]">{snapshot.profile.bio}</p>}
      <div className="mt-4 rounded-xl bg-[#f6f6f6] px-4 py-2.5 text-center text-[11px] text-[#777]">Char 的私人账号</div>
    </div>
    <div className="border-b border-[#eee] py-3 text-center text-xs font-semibold text-[#555]"><GridFour size={17} className="mr-1 inline"/>发布记录</div>
    {instagram?<div className="grid grid-cols-3 gap-0.5">
      {snapshot.posts.map(p=><button key={p.id} type="button" onClick={()=>onSelect(p.id)} className="relative aspect-square overflow-hidden bg-gradient-to-br from-[#e0e0e0] to-[#f6f6f6] p-2 text-left">
        <span className="line-clamp-4 text-[11px] leading-5 text-[#777]">{p.visual||p.text}</span>
      </button>)}
    </div>:<div className="bg-[#f4f4f4] py-2">{snapshot.posts.map(p=><WeiboPost key={p.id} post={p} name={name} avatar={avatar}/>)}</div>}
  </div>;
}
function Empty({text}:{text:string}){
  return <div className="flex min-h-[240px] flex-col items-center justify-center px-8 text-center">
    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f1f1]"><GridFour size={25} color="#888"/></div>
    <p className="text-xs leading-6 text-[#888]">{text}</p>
  </div>;
}
export default function CharacterPhoneSocialContentPage({
  appId,char,userProfile,groups,realtimeConfig,api,ownerAvatar,onBack,
}:Props){
  const instagram=appId==='instagram',tabs=instagram?INSTAGRAM_TABS:WEIBO_TABS;
  const [tab,setTab]=useState<TabId>('home');
  const [snapshot,setSnapshot]=useState<SocialSnapshot|null>(()=>readSocialSnapshot(char.id,appId));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [selectedPostId,setSelectedPostId]=useState('');
  useEffect(()=>{
    setSnapshot(readSocialSnapshot(char.id,appId));setTab('home');setSelectedPostId('');setError('');
    const onChange=(event:Event)=>{
      const d=(event as CustomEvent<{characterId:string;appId:SocialContentApp}>).detail;
      if(d?.characterId===char.id&&d.appId===appId)setSnapshot(readSocialSnapshot(char.id,appId));
    };
    window.addEventListener(SOCIAL_SNAPSHOT_CHANGED,onChange);
    return()=>window.removeEventListener(SOCIAL_SNAPSHOT_CHANGED,onChange);
  },[char.id,appId]);
  const generate=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{
      const next=await generateSocialSnapshot({char,user:userProfile,groups,realtimeConfig,api,appId});
      setSnapshot(next);setSelectedPostId('');
    }catch(e){setError(e instanceof Error?e.message:'生成失败，原记录保留');}
    finally{setBusy(false);}
  };
  const selected=snapshot?.posts.find(p=>p.id===selectedPostId);
  const interactions=snapshot?.posts.flatMap(p=>p.comments.map(c=>({...c,post:p})))||[];
  return <section className="flex min-h-full flex-col bg-[#f6f6f6] text-[#242424]">
    <header className="sticky top-0 z-20 flex min-h-[56px] items-center gap-2 border-b border-[#ededed] bg-white/95 px-3 backdrop-blur-md">
      <button type="button" aria-label="返回" onClick={selected?()=>setSelectedPostId(''):onBack} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-[#f4f4f4]"><ArrowLeft size={21}/></button>
      <strong className={'min-w-0 flex-1 truncate '+(instagram?'font-serif text-[20px] italic':'text-center text-[17px] font-semibold')}>{selected?'帖子详情':instagram?'Instagram':'微博'}</strong>
      <button type="button" onClick={()=>void generate()} disabled={busy}
        aria-label={(snapshot?'重新生成':'AI生成')+(instagram?' Instagram':'微博')+'内容'}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#d8d8d8] bg-[#f5f5f5] px-3 py-2 text-[11px] font-medium text-[#333] disabled:opacity-50">
        {busy?<SpinnerGap size={15} className="animate-spin"/>:<Sparkle size={15}/>}
        {busy?'生成中':snapshot?'重新生成':'AI生成'}
      </button>
    </header>
    {error&&<div role="alert" className="mx-3 mt-3 rounded-xl border border-[#e4e4e4] bg-white px-4 py-3 text-xs leading-5 text-[#777]">{error}</div>}
    {snapshot&&<div className="border-b border-[#eee] bg-white px-4 py-2 text-[10px] text-[#999]">
      Char 私人内容 · 上次生成 {dateLabel(snapshot.generatedAt)} · 每次只刷新当前 App
    </div>}
    <div className="min-h-[330px] flex-1">
      {!snapshot?<div className="flex min-h-[330px] flex-col items-center justify-center px-9 text-center">
        <div className="mb-4 flex h-[76px] w-[76px] items-center justify-center rounded-[23px] bg-white text-[#888] shadow-sm"><Sparkle size={30} weight="thin"/></div>
        <h3 className="text-sm font-semibold">{instagram?'Instagram':'微博'}尚无内容</h3>
        <p className="mt-2 text-xs leading-6 text-[#888]">点击右上角 AI生成，读取 Char 的人设、私聊、日程与已知 NPC，生成这个账号的发布、浏览和互动记录。</p>
        <button type="button" onClick={()=>void generate()} disabled={busy} className="mt-5 rounded-xl bg-[#333] px-6 py-2.5 text-xs text-white disabled:opacity-50">{busy?'生成中…':'AI生成界面内容'}</button>
      </div>:selected?<div className="pt-3">{instagram?
        <InstagramPost post={selected} name={char.name} avatar={ownerAvatar} handle={snapshot.profile.handle}/>:
        <WeiboPost post={selected} name={char.name} avatar={ownerAvatar}/>}
      </div>:tab==='profile'?<Profile snapshot={snapshot} name={char.name} avatar={ownerAvatar} instagram={instagram} onSelect={setSelectedPostId}/>:
      tab==='home'?<div className={instagram?'bg-white':'bg-[#f4f4f4] py-2'}>
        {snapshot.posts.length?snapshot.posts.map(post=>instagram?
          <InstagramPost key={post.id} post={post} name={char.name} avatar={ownerAvatar} handle={snapshot.profile.handle}/>:
          <WeiboPost key={post.id} post={post} name={char.name} avatar={ownerAvatar}/>):<Empty text="Char 暂时没有发布内容"/>}
      </div>:tab==='replies'?<div className="space-y-2 p-3">
        {interactions.length?interactions.map(c=><article key={c.post.id+':'+c.id} className="rounded-2xl bg-white p-4 text-xs leading-6">
          <strong className="text-[#333]">{c.authorName}</strong><span className="ml-2 text-[10px] text-[#999]">{c.knownNpc?'已知联系人':'平台网友'}</span>
          <p className="mt-1 text-[#555]">{c.content}</p>
          <div className="mt-3 rounded-xl bg-[#f4f4f4] px-3 py-2 text-[#888]">回复的帖子：{c.post.text.slice(0,95)}</div>
          {c.charReply&&<p className="mt-2 text-[#555]"><b>{char.name} 回复：</b>{c.charReply}</p>}
        </article>):<Empty text="暂时没有 NPC 评论互动"/>}
      </div>:<div className={instagram?'bg-white':'bg-[#f6f6f6] py-2'}>
        {tab==='explore'&&<div className="grid grid-cols-3 gap-0.5 bg-white p-0.5">
          {snapshot.viewed.filter(p=>p.visual).map(p=><div key={p.id} className="relative"><GeneratedVisual description={p.visual}/></div>)}
        </div>}
        {tab==='reels'&&<div className="mx-3 mt-3 rounded-xl bg-[#e9e9e9] px-4 py-3 text-xs text-[#777]">视频不实际播放，展示 Char 看过的内容摘要</div>}
        {snapshot.viewed.length?snapshot.viewed.map(item=><SeenCard key={item.id} item={item} name={char.name} instagram={instagram}/>):<Empty text="暂无浏览或评论记录"/>}
      </div>}
    </div>
    {!selected&&<nav aria-label="应用栏目" className="sticky bottom-0 z-20 grid shrink-0 border-t border-[#eee] bg-white/95 py-2 backdrop-blur-md" style={{gridTemplateColumns:'repeat('+tabs.length+',minmax(0,1fr))'}}>
      {tabs.map(({id,label,Icon})=><button type="button" key={id} onClick={()=>setTab(id)} aria-current={tab===id?'page':undefined}
        className={'flex flex-col items-center gap-1 py-1 text-[10px] '+(tab===id?'font-semibold text-[#222]':'text-[#999]')}>
        <Icon size={21} weight={tab===id?'fill':'regular'}/><span>{label}</span>
      </button>)}
    </nav>}
  </section>;
}
