import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChatCircleDots,NotePencil,Globe,PaintBrush,Phone,ChatText,Images,
  MapPin,Heart,CalendarBlank,CaretRight,SpinnerGap,BookOpen,
  DotsThree,ImageSquare,Camera,Check,ArrowCounterClockwise} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';
import './characterPhoneHome.css';
import {CharacterPhoneSocialIcon} from './CharacterPhoneSocialApps';
import {CHARACTER_PHONE_SOCIAL_APP_INFO,type CharacterPhoneInstallPlan,type CharacterPhoneSocialAppId} from '../../utils/characterPhoneAppInstall';
import {
  readPhoneAppearance,savePhoneAppearance,compressPhoneAppearanceImage,relationshipDayCount,
  PHONE_APPEARANCE_CHANGED,type PhoneAppearance,
} from '../../utils/characterPhoneAppearance';

export type PhoneHomeTarget='wechat'|'memo'|'browser'|'beautify'|'calls'|'sms'|'gallery'|'settings'|'wallet'|'profile'|CharacterPhoneSocialAppId;
const PAPER='rounded-[23px] border border-white/80 bg-white/65 shadow-[0_10px_34px_rgba(58,58,58,0.08),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-lg';
const PRESETS:Record<PhoneAppearance['preset'],string>={
  mist:'radial-gradient(ellipse at 12% 12%,#fff 0%,transparent 46%),radial-gradient(ellipse at 95% 75%,#fff 0%,transparent 56%),repeating-linear-gradient(121deg,transparent 0px,transparent 20px,#d3d3d3 21px,transparent 22px),linear-gradient(145deg,#f1f1f1,#dddddd 50%,#f5f5f5)',
  paper:'radial-gradient(circle at 72% 20%,#fff 0%,transparent 53%),repeating-linear-gradient(30deg,transparent 0px,transparent 33px,#e7e7e7 34px,transparent 35px),linear-gradient(155deg,#f8f8f8,#e9e9e9)',
  graphite:'radial-gradient(ellipse at 38% 12%,#eeeeee 0%,transparent 55%),linear-gradient(155deg,#e0e0e0,#bbb 65%,#eeeeee)',
};
function useAppearance(id:string){
  const [value,setValue]=useState(()=>readPhoneAppearance(id));
  useEffect(()=>{
    setValue(readPhoneAppearance(id));
    const listen=(event:Event)=>{
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===id)setValue(readPhoneAppearance(id));
    };
    window.addEventListener(PHONE_APPEARANCE_CHANGED,listen);
    return()=>window.removeEventListener(PHONE_APPEARANCE_CHANGED,listen);
  },[id]);
  return value;
}
function Wallpaper({appearance,children,className=''}:{appearance:PhoneAppearance;children:React.ReactNode;className?:string}){
  const backgroundImage=appearance.wallpaper
    ?'linear-gradient(rgba(246,246,246,.48),rgba(231,231,231,.58)),url("'+appearance.wallpaper+'")'
    :PRESETS[appearance.preset];
  return <div className={'relative isolate overflow-hidden '+className} style={{backgroundImage,backgroundSize:'cover',backgroundPosition:'center'}}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-30"
      style={{backgroundImage:'radial-gradient(#fff 1px,transparent 1px)',backgroundSize:'19px 19px'}}/>
    <div className="relative z-[1] flex h-full min-h-0 flex-col">{children}</div>
  </div>;
}
function Polaroids({left,right,name,userName}:{left?:string;right?:string;name:string;userName:string}){
  return <div className="cp-home-polaroids" aria-label="双照片拍立得组件">
    <div className="cp-home-polaroid cp-home-polaroid--left">
      <PhoneAvatar src={left} name={name} className="cp-home-polaroid-photo bg-[#d9d9d9] text-base"/>
    </div>
    <div className="cp-home-polaroid cp-home-polaroid--right">
      <PhoneAvatar src={right} name={userName} className="cp-home-polaroid-photo bg-[#c9c9c9] text-base"/>
    </div>
    <div aria-hidden="true" className="absolute left-[40%] top-[3%] h-[12px] w-[38px] -rotate-6 bg-white/70 shadow-sm"/>
  </div>;
}
function Shortcut({label,Icon,onClick}:{label:string;Icon:React.ComponentType<any>;onClick:()=>void}){
  return <button type="button" onClick={onClick} className="cp-home-shortcut">
    <span className="cp-home-icon"><Icon size={31} weight="regular"/></span>
    <span className="cp-home-shortcut-label">{label}</span>
  </button>;
}
function Couple({name,userName,owner,user,anniversary}:{name:string;userName:string;owner?:string;user?:string;anniversary:string}){
  const days=relationshipDayCount(anniversary);
  return <section aria-label="情侣头像纪念组件" className="cp-home-couple">
    <div className="cp-home-couple-pics">
      <div className="z-10 rounded-full border-[3px] border-white/75 p-0.5 shadow-[0_3px_15px_rgba(0,0,0,.12)]">
        <PhoneAvatar src={owner} name={name} className="cp-home-couple-avatar rounded-full text-sm"/>
      </div>
      <div aria-hidden="true" className="relative -mx-[2px] flex w-6 shrink-0 items-center justify-center text-[14px] text-[#858585]">
        <span className="absolute h-[1px] w-full bg-[#a0a0a0]"/>♡
      </div>
      <div className="z-10 rounded-full border-[3px] border-white/75 p-0.5 shadow-[0_3px_15px_rgba(0,0,0,.12)]">
        <PhoneAvatar src={user} name={userName} className="cp-home-couple-avatar rounded-full text-sm"/>
      </div>
    </div>
    <span className="whitespace-nowrap text-[11px] tracking-wider text-[#777]">我们已经相爱</span>
    <strong className="cp-home-couple-days tabular-nums">{days??'—'}</strong>
    <span className="text-[10px] font-medium tracking-[.12em] text-[#929292]">{days===null?'设置纪念日':'DAYS'}</span>
    <span aria-hidden="true" className="text-[11px] text-[#aaa]">♡</span>
  </section>;
}
export function CharacterPhoneLockScreen({characterId,name,avatar,onUnlock,onClose}:{
  characterId:string;name:string;avatar?:string;onUnlock:()=>void;onClose:()=>void;
}){
  const appearance=useAppearance(characterId);
  return <Wallpaper appearance={appearance} className="min-h-0 flex-1 overflow-y-auto">
    <div className="flex items-center justify-between px-5 py-3 text-xs text-[#777]">
      <button onClick={onClose} type="button" className="flex items-center gap-1 rounded-full border border-white/80 bg-white/70 px-3 py-2"><ArrowLeft size={16}/>返回</button>
      <span className="tracking-[.24em]">PRIVATE PHONE</span>
    </div>
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 pb-6 pt-4">
      <div className={PAPER+' flex w-full max-w-[315px] flex-col items-center px-6 pb-7 pt-9'}>
        <div className="rounded-full border-[5px] border-white/80 p-1 shadow-[0_10px_25px_rgba(0,0,0,.12)]">
          <PhoneAvatar src={avatar} name={name} className="h-[95px] w-[95px] rounded-full text-3xl"/>
        </div>
        <span className="mt-4 max-w-full truncate text-sm tracking-wider text-[#777]">{name}</span>
        <h2 className="mt-5 text-center font-serif text-[21px] font-semibold leading-8 text-[#444]">准备进入{name}的手机</h2>
        <p className="mt-2 text-center text-xs leading-6 text-[#888]">点按进入后，才加载查手机桌面与角色的应用清单</p>
        <div className="my-5 h-px w-full bg-white/95"/>
        <div className="h-[155px] w-full max-w-[176px]"><Polaroids left={appearance.polaroidLeft||avatar} right={appearance.polaroidRight||avatar} name={name} userName={name}/></div>
      </div>
      <button onClick={onUnlock} type="button"
        className="flex w-full max-w-[275px] items-center justify-center gap-4 rounded-full border border-white/90 bg-white/80 px-6 py-4 text-[15px] font-medium text-[#555] shadow-[0_8px_24px_rgba(0,0,0,.1)] backdrop-blur-xl">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ededed] text-lg">♡</span>
        点按进入 <CaretRight size={18}/>
      </button>
    </div>
  </Wallpaper>;
}
export function CharacterPhoneHome({characterId,name,avatar,userAvatar,userName,installPlan,installBusy,installNotice,onOpen,onRetryInstall,onClose}:{
  characterId:string;name:string;avatar?:string;userAvatar?:string;userName:string;
  installPlan:CharacterPhoneInstallPlan|null;installBusy:boolean;installNotice:string;
  onOpen:(id:PhoneHomeTarget)=>void;onRetryInstall:()=>void;onClose:()=>void;
}){
  const appearance=useAppearance(characterId);
  const [page,setPage]=useState(0);
  const startX=useRef<number|null>(null);
  useEffect(()=>setPage(0),[characterId]);
  const dateText=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
  return <Wallpaper appearance={appearance} className="cp-home-wallpaper">
    <div className="cp-home-topbar">
      <button type="button" aria-label="退出查手机" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/75 bg-white/65 text-[#555]"><ArrowLeft size={18}/></button>
      <span className="min-w-0 truncate px-2 text-[11px] tracking-[.12em] text-[#777]">{name} · PHONE</span>
      <button type="button" aria-label="查手机美化" onClick={()=>onOpen('beautify')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/75 bg-white/65 text-[#555]"><PaintBrush size={17}/></button>
    </div>
    <div className="cp-home-body" onTouchStart={e=>{startX.current=e.touches[0].clientX;}}
      onTouchEnd={e=>{if(startX.current===null)return;const dx=e.changedTouches[0].clientX-startX.current;startX.current=null;if(Math.abs(dx)>75)setPage(dx<0?1:0);}}>
      {page===0?<>
        <div className="cp-home-topwidgets">
          <section className={PAPER+' cp-home-owner'}>
            <PhoneAvatar src={avatar} name={name} className="cp-home-owner-avatar rounded-full border-[3px] border-white/85 text-xl shadow-md"/>
            <strong className="max-w-full truncate px-1 text-[13px] font-medium tracking-wider text-[#555]">{name}</strong>
            <div className="cp-home-location rounded-full border border-white/90 bg-white/65 text-[10px] text-[#777]">
              <MapPin size={13} className="shrink-0"/><span className="truncate">{appearance.location||'未设置地点'}</span>
            </div>
          </section>
          <Polaroids left={appearance.polaroidLeft||avatar} right={appearance.polaroidRight||userAvatar||avatar} name={name} userName={userName}/>
        </div>
        <section className={PAPER+' cp-home-quote'}>
          <div className="cp-home-quote-header">
            <PhoneAvatar src={avatar} name={name} className="cp-home-quote-avatar rounded-full text-sm"/>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[13px] font-medium text-[#555]">{name}</strong>
              <p className="truncate text-[11px] text-[#888]">{appearance.caption||'记录生活里不经意的小事'}</p>
            </div>
            <span aria-hidden="true" className="text-lg text-[#aaa]">···</span>
          </div>
          <p className="cp-home-quote-text">{appearance.quote||'总有一些细碎的日常，值得被好好收藏。'}</p>
          <div className="cp-home-date rounded-full border border-white/90 bg-white/50 text-[10px] text-[#777]">{dateText}</div>
        </section>
        <div className="cp-home-middle">
          <div className="cp-home-apps">
            <Shortcut label="微信" Icon={ChatCircleDots} onClick={()=>onOpen('wechat')}/>
            <Shortcut label="备忘录" Icon={NotePencil} onClick={()=>onOpen('memo')}/>
            <Shortcut label="浏览器" Icon={Globe} onClick={()=>onOpen('browser')}/>
            <Shortcut label="美化" Icon={PaintBrush} onClick={()=>onOpen('beautify')}/>
          </div>
          <Couple name={name} userName={userName} owner={avatar} user={userAvatar||avatar} anniversary={appearance.anniversary}/>
        </div>
        <div aria-hidden="true" className="cp-home-decoration">
          <span>有些心事，留在这里。</span><span>A little closer to you.</span>
        </div>
      </>:<div className="cp-home-page-two" style={{gridRow:'1 / -1'}}>
        <section className={PAPER+' cp-home-page-two-heading'}>
          <p className="text-[10px] tracking-[.22em] text-[#999]">SECOND PAGE</p>
          <h3 className="mt-1 text-[16px] font-medium text-[#4b4b4b]">更多应用</h3>
          <p className="mt-1 text-[11px] leading-5 text-[#8e8e8e]">这里只显示 Char 实际安装的可选软件。</p>
        </section>
        <div className="cp-home-page-two-apps">
          {(installPlan?.installedAppIds||[]).map(id=><button type="button" key={id} onClick={()=>onOpen(id)}>
            <CharacterPhoneSocialIcon appId={id}/>
            <span className="text-[#555]">{CHARACTER_PHONE_SOCIAL_APP_INFO[id].label}</span>
          </button>)}
          {/* 钱包、个人资料和设置依然属于微信 → 我，不拆成独立入口。 */}
        </div>
        {(installBusy||installNotice||!installPlan)&&<div role="status" className={PAPER+' px-3 py-2 text-[11px] leading-5 text-[#777]'}>
          {installBusy?<span className="flex items-center gap-2"><SpinnerGap size={16} className="animate-spin"/>正在为 Char 分析安装软件…</span>:installNotice||'尚未生成可选应用清单'}
          {!installBusy&&!installPlan&&<button type="button" onClick={onRetryInstall} className="mt-2 block rounded-full bg-[#444] px-4 py-2 text-white">重新分析安装</button>}
        </div>}
        {installPlan?.reason&&<p className="px-2 text-[10px] leading-4 text-[#777]">安装偏好：{installPlan.reason}</p>}
      </div>}
    </div>
    <div className="cp-home-pages" aria-label="查手机桌面页码">
      {[0,1].map(i=><button type="button" key={i} onClick={()=>setPage(i)} aria-label={'打开第'+(i+1)+'页'}
        aria-current={page===i?'page':undefined} className={'h-2 rounded-full transition-all '+(page===i?'w-5 bg-[#555]':'w-2 bg-[#bdbdbd]')}/> )}
    </div>
    <nav aria-label="电话短信相册快捷栏" className={PAPER+' cp-home-dock'}>
      <Shortcut label="电话" Icon={Phone} onClick={()=>onOpen('calls')}/>
      <Shortcut label="短信" Icon={ChatText} onClick={()=>onOpen('sms')}/>
      <Shortcut label="相册" Icon={Images} onClick={()=>onOpen('gallery')}/>
    </nav>
  </Wallpaper>;
}
export function CharacterPhoneBeautify({characterId,onBack}:{characterId:string;onBack:()=>void}){
  const appearance=useAppearance(characterId);
  const [notice,setNotice]=useState('');
  const patch=(update:Partial<PhoneAppearance>)=>{
    try{savePhoneAppearance(characterId,update);setNotice('已保存到这个 Char 的手机');}
    catch{setNotice('保存失败，请检查设备剩余存储空间');}
  };
  const upload=async(field:'wallpaper'|'polaroidLeft'|'polaroidRight',file?:File)=>{
    if(!file)return;
    setNotice('正在保存照片…');
    try{const data=await compressPhoneAppearanceImage(file);patch({[field]:data});}
    catch(e){setNotice(e instanceof Error?e.message:'图片加载失败');}
  };
  const photoField=(label:string,field:'wallpaper'|'polaroidLeft'|'polaroidRight')=>
    <div className="flex items-center gap-3 rounded-2xl border border-[#ebebeb] bg-[#fafafa] p-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#ddd] bg-[#e9e9e9] text-[#888]">
        {appearance[field]?<img src={appearance[field]} alt={label+'预览'} className="h-full w-full object-cover"/>:<ImageSquare size={28}/>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[#444]">{label}</p>
        <div className="mt-2 flex items-center gap-3">
          <label className="cursor-pointer rounded-full border border-[#d6d6d6] bg-white px-3 py-1.5 text-xs text-[#555]">
            选本地照片<input type="file" accept="image/*" className="hidden" onChange={e=>{void upload(field,e.target.files?.[0]);e.target.value='';}}/>
          </label>
          {appearance[field]&&<button type="button" className="text-xs text-[#888] underline" onClick={()=>patch({[field]:''})}>恢复默认</button>}
        </div>
      </div>
    </div>;
  return <div className="min-h-full bg-[#f4f4f4] pb-6 text-[#444]">
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#e8e8e8] bg-white/90 px-5 py-4 backdrop-blur-md">
      <button type="button" onClick={onBack} aria-label="返回桌面"><ArrowLeft size={21}/></button>
      <strong className="flex-1 text-center text-[16px]">桌面美化</strong><PaintBrush size={21}/>
    </header>
    <div className="space-y-4 p-4">
      <section className="rounded-[22px] bg-white p-4 shadow-sm">
        <h3 className="text-sm font-medium">桌面壁纸</h3>
        <p className="mb-4 mt-2 text-xs leading-5 text-[#888]">仅修改这个 Char 的查手机外观，不触发生图或 AI。</p>
        {photoField('整页背景壁纸','wallpaper')}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(['mist','paper','graphite'] as const).map((preset,i)=><button type="button" key={preset} onClick={()=>patch({preset})}
            className={'rounded-2xl border p-2 text-xs '+(appearance.preset===preset?'border-[#666]':'border-[#eee]')}>
            <div className="mb-2 h-[55px] rounded-xl border border-white/60" style={{backgroundImage:PRESETS[preset]}}/>
            {['雾灰','浅纸','石墨'][i]} {appearance.preset===preset?'✓':''}
          </button>)}
        </div>
      </section>
      <section className="space-y-3 rounded-[22px] bg-white p-4 shadow-sm">
        <h3 className="text-sm font-medium">上方双拍立得</h3>
        <p className="text-xs text-[#888]">默认显示 Char 与 User 的已有头像，也可以各自换成本地照片。</p>
        {photoField('左边照片','polaroidLeft')}
        {photoField('右边照片','polaroidRight')}
      </section>
      <section className="space-y-3 rounded-[22px] bg-white p-4 shadow-sm">
        <h3 className="text-sm font-medium">文案与纪念组件</h3>
        {([
          {key:'location',label:'头像卡片地点',placeholder:'例如：首尔'},
          {key:'caption',label:'副标题',placeholder:'记录生活里不经意的小事'},
          {key:'quote',label:'文案条正文',placeholder:'总有一些细碎的日常，值得被好好收藏。'},
        ] as const).map(({key,label,placeholder})=><label key={key} className="block text-xs text-[#777]">
          <span className="mb-2 block">{label}</span>
          <input value={appearance[key]} placeholder={placeholder} onChange={e=>patch({[key]:e.target.value})}
            className="w-full rounded-xl border border-[#e6e6e6] bg-[#f8f8f8] px-3 py-3 text-[13px] text-[#444] outline-none focus:border-[#aaa]"/>
        </label>)}
        <label className="block text-xs text-[#777]"><span className="mb-2 block">纪念日（不设置则不显示天数）</span>
          <input type="date" value={appearance.anniversary} onChange={e=>patch({anniversary:e.target.value})}
            className="w-full rounded-xl border border-[#e6e6e6] bg-[#f8f8f8] px-3 py-3 text-[13px] text-[#444]"/>
        </label>
        <p className="text-xs leading-5 text-[#999]">两侧情侣头像始终读取 Char 和 User 的现有头像；纪念日仅由你手动填写，不会推测关系。</p>
      </section>
      {notice&&<div role="status" className="rounded-xl bg-white px-4 py-3 text-xs text-[#666]">{notice}</div>}
    </div>
  </div>;
}
