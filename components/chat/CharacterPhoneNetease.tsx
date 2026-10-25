/** Character's existing music persona and corner, moved into their OPTIONAL Netease phone app.
 * This reuses the real CharVisitPage and MusicContext; no duplicate music profile,
 * no new sign-in requirement, no recreated playlists or automatic LLM call.
 */
import React,{useState} from 'react';
import {ArrowLeft,MusicNotes,Play,Pause,SkipBack,SkipForward,Disc,Heart} from '@phosphor-icons/react';
import {useMusic} from '../../context/MusicContext';
import CharVisitPage from '../../apps/music/CharVisitPage';
export default function CharacterPhoneNetease({characterId,onBack}:{
  characterId:string;onBack:()=>void;
}){
  const [playerOpen,setPlayerOpen]=useState(false);
  const {current,playing,togglePlay,nextSong,prevSong,listeningTogetherWith}=useMusic();
  return <section className="relative flex h-[min(77dvh,690px)] min-h-[380px] flex-col overflow-hidden bg-[#f6f6f6] text-[#333]">
    {!playerOpen ? <div className="relative min-h-0 flex-1 grayscale">
      <CharVisitPage charId={characterId} onBack={onBack} onOpenPlayer={()=>setPlayerOpen(true)}/>
    </div> : <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[#eaeaea] bg-white/90 px-4 py-3">
        <button type="button" onClick={()=>setPlayerOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full text-[#555]" aria-label="返回音乐角落"><ArrowLeft size={22}/></button>
        <div className="text-center"><strong className="block text-[13px]">角色音乐角落</strong><span className="text-[10px] text-[#aaa]">网易云 · 正在播放</span></div>
        <span className="flex h-10 w-10 items-center justify-center text-[#999]"><MusicNotes size={19}/></span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="flex h-44 w-44 items-center justify-center rounded-full border-[12px] border-[#333] bg-[repeating-radial-gradient(circle,#242424_0px,#242424_2px,#464646_3px,#242424_4px)] shadow-[0_15px_35px_rgba(0,0,0,.18)]">
          <div className="flex h-[61px] w-[61px] items-center justify-center rounded-full border-4 border-[#eee] bg-gradient-to-br from-[#ddd] to-[#888] text-[#444]"><Disc size={27}/></div>
        </div>
        <h3 className="mt-8 max-w-full truncate text-[16px] font-semibold">{current?.name||'没有正在播放的歌曲'}</h3>
        <p className="mt-1 max-w-full truncate text-xs text-[#888]">{current?.artists||'在音乐角落选择一首歌即可播放'}</p>
        {listeningTogetherWith.length>0&&<div className="mt-3 rounded-full bg-[#e6e6e6] px-3 py-1 text-[10px] text-[#777]">一起听中</div>}
        <div className="mt-8 flex items-center gap-8 text-[#3b3b3b]">
          <button type="button" disabled={!current} aria-label="上一首" onClick={prevSong} className="disabled:opacity-30"><SkipBack size={29} weight="fill"/></button>
          <button type="button" disabled={!current} aria-label={playing?'暂停':'播放'} onClick={togglePlay}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[#333] text-white shadow-lg disabled:opacity-30">{playing?<Pause size={26} weight="fill"/>:<Play size={26} weight="fill"/>}</button>
          <button type="button" disabled={!current} aria-label="下一首" onClick={nextSong} className="disabled:opacity-30"><SkipForward size={29} weight="fill"/></button>
        </div>
      </div>
      <button type="button" onClick={()=>setPlayerOpen(false)} className="mx-4 mb-4 rounded-full border border-[#ddd] bg-white px-4 py-3 text-xs text-[#666]">返回音乐人格与歌单</button>
    </div>}
  </section>;
}
