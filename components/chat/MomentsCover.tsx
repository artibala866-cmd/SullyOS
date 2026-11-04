import React, {useEffect, useRef, useState} from 'react';
import {ImageSquare} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';

type MomentsCoverProps = {
  name: string;
  avatar?: string;
  cover?: string;
  onSelectCover: (file: File) => void;
  onRestoreDefault: () => void;
};

/**
 * WeChat-style Moments cover: expands as the page opens, elastically stretches
 * with the pull distance, and opens the native photo picker in one tap.
 * The avatar remains outside the clipped image so it can overlap the feed.
 */
export default function MomentsCover({
  name, avatar, cover, onSelectCover, onRestoreDefault,
}: MomentsCoverProps) {
  const inputRef=useRef<HTMLInputElement>(null);
  const [expanded,setExpanded]=useState(false);
  const [fullCover,setFullCover]=useState(false);
  const [reducedMotion,setReducedMotion]=useState(false);

  useEffect(()=>{
    const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setReducedMotion(reduce);
    if(reduce){setExpanded(true);return;}
    // Two frames ensure the short cover paints before its entrance expansion.
    let secondFrame=0;
    const firstFrame=window.requestAnimationFrame(()=>{
      secondFrame=window.requestAnimationFrame(()=>setExpanded(true));
    });
    return ()=>{
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  },[]);

  const height=fullCover
    ? 'calc(min(82dvh, 900px) + var(--moments-cover-pull, 0px))'
    : expanded
      ? 'calc(clamp(300px, 50dvh, 450px) + var(--moments-cover-pull, 0px))'
      : '256px';

  return <section aria-label="朋友圈封面" className="relative isolate bg-[#b9c6cb]"
    style={{
      height,
      transition:reducedMotion?'none':'var(--moments-cover-transition, height 540ms cubic-bezier(.22,1,.36,1))',
    }}>
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#90a3af] via-[#bacbd0] to-[#e2e7e4]">
      {cover && <img src={cover} alt="朋友圈封面背景" className="absolute inset-0 h-full w-full object-cover" />}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/35 via-black/10 to-transparent"/>
    </div>

    {/* Tapping the cover reproduces WeChat's second, full-height expansion. */}
    <button type="button" aria-label={fullCover?'收起朋友圈封面':'展开朋友圈封面'}
      onClick={()=>setFullCover(value=>!value)}
      className="absolute inset-0 z-[1] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"/>

    <button type="button" aria-label="换封面，从本地相册选择图片"
      onClick={()=>inputRef.current?.click()}
      className={'absolute bottom-5 right-4 z-10 flex flex-col items-center gap-0.5 px-1.5 py-1 text-[12px] font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.7)] transition-all duration-300 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white '+
        (fullCover?'translate-y-0 opacity-100':'pointer-events-none translate-y-2 opacity-0')}>
      <ImageSquare size={23} weight="regular" aria-hidden="true"/>
      <span>换封面</span>
    </button>
    <input ref={inputRef} type="file" accept="image/*" className="sr-only"
      aria-label="从本地相册选择朋友圈封面"
      onChange={event=>{
        const selected=event.currentTarget.files?.[0];
        event.currentTarget.value='';
        if(selected){onSelectCover(selected);setFullCover(false);}
      }}/>

    {cover && <button type="button" onClick={()=>{onRestoreDefault();setFullCover(false);}} aria-label="恢复默认朋友圈封面"
      className={'absolute bottom-5 left-4 z-10 px-2 py-1.5 text-[11px] text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,.7)] transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-white '+
        (fullCover?'opacity-100':'pointer-events-none opacity-0')}>
      恢复默认
    </button>}

    <strong className={'pointer-events-none absolute bottom-5 right-24 max-w-[calc(100%-8rem)] truncate text-xl font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,.5)] transition-opacity duration-200 '+(fullCover?'opacity-0':'opacity-100')}>{name}</strong>
    <div className={'pointer-events-none absolute -bottom-8 right-5 z-10 transition-opacity duration-200 '+(fullCover?'opacity-0':'opacity-100')}>
      <PhoneAvatar key={avatar||name} src={avatar} name={name}
        className="h-20 w-20 rounded-xl border-4 border-white bg-white text-3xl shadow-sm"/>
    </div>
  </section>;
}
