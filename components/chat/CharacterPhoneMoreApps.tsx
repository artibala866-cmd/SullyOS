/** Optional Char-phone shells. No fake feeds, no eager AI calls and no fabricated messages. */
import React,{useEffect,useState} from 'react';
import {
  ArrowLeft,House,User,BookOpen,Books,FilmSlate,ChatDots,VideoCamera,
  MagnifyingGlass,Heart,BookmarkSimple,EnvelopeSimple,PaperPlaneTilt,
  Archive,Star,Notebook,ClockCounterClockwise,Compass,GridFour,PenNib,
  Newspaper,At,Play,MusicNotes,
} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';
import type {CharacterPhoneSocialAppId} from '../../utils/characterPhoneAppInstall';

export type ShellAppId=Extract<CharacterPhoneSocialAppId,'douban'|'douyin'|'email'|'jinjiang'>;
const appData={
 douban:{title:'豆瓣',hint:'阅读 · 电影 · 小组',tabs:[
   {id:'home',label:'首页',Icon:House},{id:'books',label:'书影音',Icon:BookOpen},
   {id:'groups',label:'小组',Icon:ChatDots},{id:'profile',label:'我的',Icon:User},
 ]},
 douyin:{title:'抖音',hint:'短视频 · 收藏 · 创作',tabs:[
   {id:'home',label:'推荐',Icon:VideoCamera},{id:'discover',label:'发现',Icon:MagnifyingGlass},
   {id:'favorites',label:'收藏',Icon:BookmarkSimple},{id:'profile',label:'我',Icon:User},
 ]},
 email:{title:'邮箱',hint:'收件箱 · 已发送 · 草稿',tabs:[
   {id:'inbox',label:'收件箱',Icon:EnvelopeSimple},{id:'sent',label:'已发送',Icon:PaperPlaneTilt},
   {id:'drafts',label:'草稿',Icon:Notebook},{id:'archive',label:'归档',Icon:Archive},
 ]},
 jinjiang:{title:'晋江文学城',hint:'作品 · 书架 · 阅读记录',tabs:[
   {id:'home',label:'书城',Icon:House},{id:'library',label:'书架',Icon:Books},
   {id:'reading',label:'阅读',Icon:BookOpen},{id:'profile',label:'我的',Icon:User},
 ]},
} as const;
const tabDesc:Record<ShellAppId,Record<string,{title:string;description:string}>>={
 douban:{
   home:{title:'动态尚未建立',description:'后续可根据 Char 的性格、书影音喜好与已有 NPC 生成短评和互动。'},
   books:{title:'书影音暂为空',description:'这里会展示 Char 自己标记、看过和评论的书籍、电影、音乐。'},
   groups:{title:'小组记录尚未建立',description:'预留 Char 加入的小组、发帖和评论。'},
   profile:{title:'个人资料尚未生成',description:'这里只展示手机主人，暂不虚构评分、友邻或互动。'},
 },
 douyin:{
   home:{title:'还没有视频浏览记录',description:'后续显示 Char 看过的视频和评论，当前不自动播放或伪造视频。'},
   discover:{title:'还没有搜索记录',description:'预留 Char 按自己兴趣浏览的话题和作者。'},
   favorites:{title:'还没有收藏',description:'之后会记录 Char 自己收藏的视频，不与其他 App 混用。'},
   profile:{title:'暂无发布作品',description:'角色主页已预留作品、喜欢与收藏区域。'},
 },
 email:{
   inbox:{title:'收件箱为空',description:'将来根据 Char 的世界书、工作和日常关系生成往来邮件。'},
   sent:{title:'暂无已发送邮件',description:'预留 Char 发出的邮件；不会擅自代 User 发信。'},
   drafts:{title:'暂时没有草稿',description:'未发送邮件以后会保存在 Char 自己的邮箱。'},
   archive:{title:'没有归档邮件',description:'邮件归档模块已预留。'},
 },
 jinjiang:{
   home:{title:'小说推荐待建立',description:'这里将根据 Char 的阅读偏好展示书城与书单。'},
   library:{title:'书架还没有小说',description:'后续显示 Char 的收藏、追更与阅读进度。'},
   reading:{title:'暂无阅读记录',description:'预留正在阅读的章节与书评，不假装已读。'},
   profile:{title:'阅读档案尚未建立',description:'读者资料与评论记录会在下一阶段接入。'},
 },
};
function TabPlaceholder({title,description,Icon}:{title:string;description:string;Icon:React.ComponentType<any>}){
 return <div className="flex min-h-[225px] flex-1 flex-col items-center justify-center px-7 text-center">
   <span className="flex h-[70px] w-[70px] items-center justify-center rounded-[24px] border border-white bg-gradient-to-br from-white via-[#f6f6f6] to-[#e8e8e8] text-[#999] shadow-sm"><Icon size={29} weight="thin"/></span>
   <strong className="mt-4 text-[13px] font-semibold text-[#424242]">{title}</strong>
   <p className="mt-2 max-w-[260px] text-[11px] leading-[20px] text-[#929292]">{description}</p>
 </div>;
}
function Owner({name,avatar,appId}:{name:string;avatar?:string;appId:ShellAppId}){
 return <div className="flex items-center gap-4 rounded-[22px] border border-[#ededed] bg-white px-4 py-4 shadow-[0_4px_18px_rgba(0,0,0,.035)]">
    <div className="rounded-full border-2 border-[#ddd] p-0.5"><PhoneAvatar name={name} src={avatar} className="h-[59px] w-[59px] rounded-full text-xl"/></div>
    <div className="min-w-0 flex-1">
      <strong className="block truncate text-[15px] text-[#333]">{name}</strong>
      <span className="mt-1 block text-[11px] text-[#999]">{appId==='email'?'手机主人的私人邮箱':appId==='jinjiang'?'读者资料':appId==='douban'?'书影音与生活记录':'短视频个人主页'}</span>
      <span className="mt-2 block w-fit rounded-full bg-[#f5f5f5] px-3 py-1 text-[10px] text-[#888]">Char 的独立账号</span>
    </div>
 </div>;
}
function DoubanCover(){
 return <div className="relative overflow-hidden rounded-[23px] border border-[#eee] bg-white px-5 pb-4 pt-5 shadow-sm">
   <div className="text-[10px] font-semibold tracking-[.2em] text-[#999]">DOUBAN · LIFE NOTES</div>
   <div className="mt-4 grid grid-cols-3 gap-3">
     {([{Icon:BookOpen,label:'读过'},{Icon:FilmSlate,label:'看过'},{Icon:MusicNotes,label:'听过'}] as const).map(({Icon,label})=>
       <div key={label} className="flex flex-col items-center gap-3 rounded-xl border border-[#efefef] bg-gradient-to-b from-[#fafafa] to-white px-2 py-4">
         <Icon size={25} color="#767676" weight="thin"/><span className="text-[11px] text-[#777]">{label}</span>
       </div>)}
   </div>
 </div>;
}
function DouyinCover(){
 return <div className="relative mx-1 min-h-[245px] overflow-hidden rounded-[24px] bg-gradient-to-br from-[#3a3a3a] via-[#202020] to-[#666] p-5 text-white shadow-sm">
   <div className="absolute right-4 top-4 rounded-full border border-white/30 px-2.5 py-1 text-[10px]">For You</div>
   <div className="absolute inset-0 flex items-center justify-center opacity-30"><Play size={83} weight="thin"/></div>
   <div className="absolute bottom-5 left-5 right-5">
     <div className="h-2 w-28 rounded-full bg-white/30"/><div className="mt-2 h-2 w-40 rounded-full bg-white/20"/>
     <p className="mt-3 text-[10px] tracking-wider text-white/70">视频预览区域 · 尚无内容</p>
   </div>
 </div>;
}
function EmailCover({tab}:{tab:string}){
 return <div className="rounded-[23px] border border-[#ececec] bg-white p-4 shadow-sm">
   <div className="flex items-center justify-between"><span className="text-xs font-semibold text-[#444]">{({inbox:'收件箱',sent:'已发送',drafts:'草稿箱',archive:'归档'} as Record<string,string>)[tab]}</span><MagnifyingGlass size={18} color="#888"/></div>
   <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f5f5f5] px-3 py-3 text-xs text-[#aaa]"><EnvelopeSimple size={18}/>搜索邮件</div>
   <div className="mt-4 flex flex-col gap-4 opacity-60">{[1,2].map(i=><div key={i} className="flex items-center gap-3"><span className="h-9 w-9 shrink-0 rounded-full bg-[#ededed]"/><span className="flex-1 space-y-2"><span className="block h-2 w-[60%] rounded bg-[#efefef]"/><span className="block h-2 w-[85%] rounded bg-[#f2f2f2]"/></span></div>)}</div>
 </div>;
}
function JinjiangCover(){
 return <div className="rounded-[23px] border border-[#eee] bg-gradient-to-br from-white to-[#f2f2f2] px-4 py-5 shadow-sm">
   <div className="flex items-center justify-between text-xs text-[#555]"><strong>我的阅读时光</strong><BookOpen size={20}/></div>
   <div className="mt-4 grid grid-cols-3 gap-3">
    {[0,1,2].map(i=><div key={i} className="flex flex-col gap-2">
      <div className="aspect-[.72] rounded-md border border-[#dedede] bg-gradient-to-br from-[#e5e5e5] to-white shadow-sm"/>
      <div className="h-1.5 w-[75%] rounded bg-[#e7e7e7]"/>
    </div>)}
   </div>
   <p className="mt-4 text-center text-[10px] text-[#999]">书架与小说数据留待后续生成</p>
 </div>;
}
/** Five new optional apps share the same restrained monochrome language, but retain their own navigation hierarchy. */
export default function CharacterPhoneMoreApps({appId,ownerName,ownerAvatar,onBack}:{
 appId:ShellAppId;ownerName:string;ownerAvatar?:string;onBack:()=>void;
}){
 const def=appData[appId];
 const [tab,setTab]=useState<string>(def.tabs[0].id);
 useEffect(()=>setTab(appData[appId].tabs[0].id),[appId]);
 const selected=def.tabs.find(item=>item.id===tab)||def.tabs[0];
 const placeholder=tabDesc[appId][tab];
 return <section className={'flex min-h-[100%] flex-col text-[#282828] '+(appId==='douyin'?'bg-[#f7f7f7]':'bg-[#f5f5f5]')}>
   <header className="sticky top-0 z-10 flex min-h-[57px] items-center gap-3 border-b border-[#eaeaea] bg-white/95 px-4 backdrop-blur-xl">
     <button type="button" aria-label="返回查手机桌面" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full text-[#444]"><ArrowLeft size={21}/></button>
     <div className="min-w-0 flex-1 text-center"><strong className="block truncate text-[16px]">{def.title}</strong><span className="block truncate text-[10px] text-[#aaa]">{def.hint}</span></div>
     <span className="flex h-9 w-9 items-center justify-center text-[#999]"><MagnifyingGlass size={20}/></span>
   </header>
   <div className="flex flex-1 flex-col gap-4 px-3 pb-5 pt-4">
     {(tab==='profile'||(appId==='douban'&&tab==='home'))&&<Owner name={ownerName} avatar={ownerAvatar} appId={appId}/>}
     {appId==='douban'&&<DoubanCover/>}
     {appId==='douyin'&&tab==='home'&&<DouyinCover/>}
     {appId==='email'&&<EmailCover tab={tab}/>}
     {appId==='jinjiang'&&tab==='home'&&<JinjiangCover/>}
     <TabPlaceholder title={placeholder.title} description={placeholder.description} Icon={selected.Icon}/>
   </div>
   <nav aria-label={def.title+'导航'} className="sticky bottom-0 z-10 grid border-t border-[#ebebeb] bg-white/95 py-2 backdrop-blur-xl" style={{gridTemplateColumns:'repeat('+def.tabs.length+',minmax(0,1fr))'}}>
     {def.tabs.map(({id,label,Icon})=><button type="button" key={id} onClick={()=>setTab(id)}
       aria-current={tab===id?'page':undefined} className={'flex min-w-0 flex-col items-center gap-1 py-1 text-[10px] '+(tab===id?'font-semibold text-[#242424]':'text-[#a1a1a1]')}>
       <Icon size={21} weight={tab===id?'fill':'regular'}/><span className="truncate">{label}</span>
     </button>)}
   </nav>
 </section>;
}
