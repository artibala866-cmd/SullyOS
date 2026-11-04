import React,{useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeft, ImageSquare} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';

type MomentsCoverProps={
  name:string;
  avatar?:string;
  cover?:string;
  expanded:boolean;
  onExpandedChange:(value:boolean)=>void;
  onSelectCover:(file:File)=>void;
  onRestoreDefault:()=>void;
};

/**
 * The existing Moments banner is collapsed on entry. Only tapping its background
 * transitions into WeChat-style cover preview. Touch scrolling is NOT a trigger.
 * Native photo selection and per-character persistent storage stay with the caller.
 */
export default function MomentsCover({
  name,avatar,cover,expanded,onExpandedChange,onSelectCover,onRestoreDefault,
}:MomentsCoverProps){
  const inputRef=useRef<HTMLInputElement>(null);
  const sectionRef=useRef<HTMLElement>(null);
  const [availableHeight,setAvailableHeight]=useState(0);

  useLayoutEffect(()=>{
    const main=sectionRef.current?.closest('main');
    if(!main)return;
    const update=()=>setAvailableHeight(Math.max(320,main.clientHeight-135));
    update();
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null;
    observer?.observe(main);
    window.addEventListener('resize',update);
    return()=>{observer?.disconnect();window.removeEventListener('resize',update);};
  },[]);

  const height=expanded?Math.max(320,availableHeight||520):256;
  const openPicker=()=>inputRef.current?.click();

  return <section ref={sectionRef} data-moments-cover="" data-expanded={String(expanded)}
    aria-label="朋友圈封面" className="relative isolate bg-[#b9c6cb]"
    style={{
      height:height+'px',
      transition:'height 520ms cubic-bezier(.22,1,.36,1)',
      willChange:'height',
    }}>
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#90a3af] via-[#bacbd0] to-[#e2e7e4]">
      {cover&&<img src={cover} alt="朋友圈封面背景" className="absolute inset-0 h-full w-full object-cover"/>}
      {/* In expanded view the original image gently blends into neutral gray at both edges,
          like the WeChat cover preview. These overlays never intercept the cover tap. */}
      <div data-testid="moments-cover-top-fade" aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height:'clamp(110px, 23%, 205px)',
          background:'linear-gradient(to bottom, rgba(137,138,140,.44) 0%, rgba(137,138,140,.19) 46%, rgba(137,138,140,0) 100%)',
          opacity:expanded?1:0,
          transition:'opacity 360ms ease-out',
        }}/>
      <div data-testid="moments-cover-bottom-fade" aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          height:'clamp(116px, 25%, 210px)',
          background:'linear-gradient(to top, rgba(118,119,121,.48) 0%, rgba(118,119,121,.21) 47%, rgba(118,119,121,0) 100%)',
          opacity:expanded?1:0,
          transition:'opacity 360ms ease-out',
        }}/>
      {/* The small footer shadow belongs to the collapsed timeline banner only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 via-black/5 to-transparent"
        style={{opacity:expanded?0:1,transition:'opacity 260ms ease-out'}}/>
    </div>

    <button type="button" data-testid="moments-cover-background"
      aria-label={expanded?'收起朋友圈封面':'点击展开朋友圈封面'}
      aria-expanded={expanded}
      onClick={()=>onExpandedChange(!expanded)}
      className="absolute inset-0 z-[1] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"/>

    {expanded&&<button type="button" aria-label="收起封面" onClick={()=>onExpandedChange(false)}
      className="absolute left-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/15 text-white/95 backdrop-blur-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
      <ArrowLeft size={22} weight="regular"/>
    </button>}

    <button type="button" data-testid="moments-cover-picker" aria-label="换封面，从本地相册选择图片"
      disabled={!expanded} onClick={openPicker}
      className={'absolute bottom-4 right-4 z-10 flex flex-col items-center gap-0.5 rounded-sm px-1.5 py-1 text-[12px] font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.65)] transition-all duration-200 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white '+
        (expanded?'translate-y-0 opacity-100':'pointer-events-none translate-y-2 opacity-0')}>
      <ImageSquare size={22} weight="regular" aria-hidden="true"/>
      <span>换封面</span>
    </button>
    <input ref={inputRef} type="file" accept="image/*" className="sr-only"
      aria-label="从本地相册选择朋友圈封面"
      onChange={event=>{
        const file=event.currentTarget.files?.[0];
        event.currentTarget.value='';
        if(file){onSelectCover(file);onExpandedChange(false);}
      }}/>

    {cover&&<button type="button" disabled={!expanded} onClick={()=>{onRestoreDefault();onExpandedChange(false);}}
      aria-label="恢复默认朋友圈封面"
      className={'absolute bottom-4 left-4 z-10 px-2 py-1.5 text-[11px] text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,.65)] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-white '+
        (expanded?'opacity-100':'pointer-events-none opacity-0')}>
      恢复默认
    </button>}

    <strong className={'pointer-events-none absolute bottom-5 right-24 max-w-[calc(100%-8rem)] truncate text-xl font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.5)] transition-opacity duration-200 '+(expanded?'opacity-0':'opacity-100')}>{name}</strong>
    <div className={'pointer-events-none absolute -bottom-8 right-5 z-10 transition-opacity duration-200 '+(expanded?'opacity-0':'opacity-100')}>
      <PhoneAvatar key={avatar||name} src={avatar} name={name}
        className="h-20 w-20 rounded-xl border-4 border-white bg-white text-3xl shadow-sm"/>
    </div>
  </section>;
}
