import React from 'react';
import {CaretDown, CaretRight, Images} from '@phosphor-icons/react';
import PhoneAvatar from './PhoneAvatar';

/** Pure profile presentation. All actions and stored data remain owned by CharacterPhone. */
export default function CharacterPhoneProfilePanel({
  name,avatar,onOpenAvatarLibrary,manualGlimpseEnabled,onToggleManualGlimpse,glimpseNotice,
  glimpseCount,lifeHistory,pokeSuffix,pokeReason,onPoke,onAdjustProfile,selfAutoBusy,selfAutoNotice,
}:{
  name:string;avatar?:string;onOpenAvatarLibrary:()=>void;
  manualGlimpseEnabled:boolean;onToggleManualGlimpse:(enabled:boolean)=>void;glimpseNotice?:string;
  glimpseCount:number;lifeHistory?:React.ReactNode;
  pokeSuffix:string;pokeReason?:string;onPoke:()=>void;onAdjustProfile:()=>void;
  selfAutoBusy:boolean;selfAutoNotice?:string;
}){
  return <div data-testid="character-phone-profile-panel"
    className="min-h-full space-y-3 bg-[#f2f2f2] px-4 pb-7 pt-4 text-[#282828]">
    <section className="rounded-2xl bg-white p-4">
      <div className="flex items-center gap-4">
        <button type="button" aria-label="打开角色头像库" onClick={onOpenAvatarLibrary}
          className="shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#555]">
          <PhoneAvatar src={avatar} name={name} className="h-[68px] w-[68px] rounded-xl text-xl"/>
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-semibold leading-7">{name}</h3>
          <p className="mt-1 text-xs text-[#939393]">此手机主人 · Char</p>
        </div>
      </div>
    </section>

    <section className="overflow-hidden rounded-2xl bg-white">
      <label className="flex min-h-[74px] cursor-pointer items-center justify-between gap-3 px-4 py-4">
        <span className="min-w-0 flex-1">
          <strong className="block text-[15px] font-medium leading-6">独立生活侧面 AI 展开</strong>
          <span className="mt-1 block text-[12px] leading-5 text-[#949494]">开启后可手动展开已记录的生活片段</span>
        </span>
        <input type="checkbox" checked={manualGlimpseEnabled}
          onChange={e=>onToggleManualGlimpse(e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer accent-[#444]"/>
      </label>
      {glimpseNotice&&<p role="status" className="px-4 pb-3 text-xs leading-5 text-[#777]">{glimpseNotice}</p>}
      {glimpseCount>0&&<details className="group border-t border-[#efefef]">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14px] text-[#393939] [&::-webkit-details-marker]:hidden">
          <span>已发生的生活片段 <span className="ml-1 text-[#999]">{glimpseCount}</span></span>
          <CaretDown size={16} className="shrink-0 text-[#aaa] transition-transform group-open:rotate-180"/>
        </summary>
        <div className="border-t border-[#f3f3f3] px-4 pb-4 pt-3">{lifeHistory}</div>
      </details>}
    </section>

    <button type="button" onClick={onOpenAvatarLibrary}
      className="flex min-h-[62px] w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left">
      <Images size={21} className="shrink-0 text-[#666]"/>
      <span className="min-w-0 flex-1 text-[15px] font-medium">头像库</span>
      <CaretRight size={17} className="text-[#aaa]"/>
    </button>

    <section className="rounded-2xl bg-white px-4 py-4">
      <h4 className="text-[15px] font-medium">戳一戳后缀</h4>
      <div className="mt-3 rounded-xl bg-[#f6f6f6] px-3.5 py-3 text-[13px] leading-6 text-[#555]">
        {pokeSuffix?'戳了戳'+name+pokeSuffix:'还没有后缀，Char 可以自己设置'}
      </div>
      {pokeReason&&<p className="mt-2 break-words text-[12px] leading-5 text-[#888]">Char 的想法：{pokeReason}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onPoke} className="min-h-[43px] rounded-xl bg-[#f0f0f0] px-3 text-[14px] font-medium text-[#383838]">戳一戳</button>
        <button type="button" disabled={selfAutoBusy} onClick={onAdjustProfile}
          className="min-h-[43px] rounded-xl bg-[#333] px-3 text-[14px] font-medium text-white disabled:opacity-50">
          {selfAutoBusy?'Char 正在调整…':'让 Char 自改'}
        </button>
      </div>
      {selfAutoNotice&&<p role="status" className="mt-3 text-xs leading-5 text-[#777]">{selfAutoNotice}</p>}
    </section>
  </div>;
}
