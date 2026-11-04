import React, {useEffect, useMemo, useState} from 'react';
import {
  ArrowLeft, ArrowRight, ArrowSquareOut, CaretRight, ClockCounterClockwise,
  Globe, Lightning, MagnifyingGlass, SpinnerGap, Trash, X,
} from '@phosphor-icons/react';
import type {CharacterProfile, GroupProfile, RealtimeConfig, UserProfile} from '../../types';
import {
  CHARACTER_PHONE_BROWSER_CHANGED, clearPhoneBrowserHistory,
  deletePhoneBrowserVisit, readCharacterPhoneBrowserHistory,
  recordPhoneBrowserNavigation, resolvePhoneBrowserNavigation,
  type PhoneBrowserVisit,
} from '../../utils/characterPhoneBrowser';
import {runCharacterPhoneBrowserAutonomy} from '../../utils/characterPhoneBrowserAutonomy';

type Api = {baseUrl:string;apiKey:string;model:string};

function browserTitle(visit:PhoneBrowserVisit):string {
  if (visit.title) return visit.title;
  if (visit.kind==='baidu-search') return visit.query;
  try {return new URL(visit.url).hostname;} catch {return visit.url;}
}

function browserHost(url:string):string {
  try {return new URL(url).hostname.replace(/^www\./,'');}
  catch {return '网页';}
}

function visitTime(visit:PhoneBrowserVisit):string {
  return new Date(visit.visitedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

/** A miniature of the SAVED navigation, not a scraped Baidu result or screenshot. */
function BrowserRecordPreview({visit,large=false}:{visit:PhoneBrowserVisit;large?:boolean}) {
  const isSearch=visit.kind==='baidu-search';
  const host=browserHost(visit.url);
  return <div className={'relative overflow-hidden bg-white text-[#263449] '+(large?'rounded-2xl border border-[#e1e8f3]':'rounded-t-2xl border-b border-[#e8edf5]')}>
    <div className={'flex items-center gap-1.5 border-b border-[#eef2f8] bg-[#f9fbff] '+(large?'px-4 py-3':'px-2.5 py-2')}>
      <span className="h-[5px] w-[5px] rounded-full bg-[#f3a9a9]"/>
      <span className="h-[5px] w-[5px] rounded-full bg-[#f1d19a]"/>
      <span className="h-[5px] w-[5px] rounded-full bg-[#a5d8b6]"/>
      <span className="ml-1 min-w-0 flex-1 truncate rounded-md bg-[#edf2fa] px-2 py-1 text-[9px] text-[#7f8fa7]">{host}</span>
    </div>
    {isSearch ? <div className={large?'px-5 pb-6 pt-5':'px-3 pb-5 pt-3'}>
      <div className={'flex items-center gap-1 font-semibold tracking-tight text-[#2767cd] '+(large?'text-[23px]':'text-[16px]')}>
        <span className="font-black">百</span><span className="text-[#e14c4c]">度</span>
        <span className="ml-auto rounded bg-[#edf3ff] px-1.5 py-0.5 text-[9px] font-medium text-[#5279b8]">搜索记录</span>
      </div>
      <div className="mt-3 flex min-h-8 items-center overflow-hidden rounded-md border border-[#cfddf6] bg-white shadow-[0_2px_8px_rgba(47,102,178,.05)]">
        <span className="min-w-0 flex-1 truncate px-2 text-[10px] text-[#334155]">{visit.query}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#3477e7] text-white"><MagnifyingGlass size={13}/></span>
      </div>
      <div className="mt-3 flex items-center gap-1.5"><span className="h-[3px] w-10 rounded-full bg-[#b0c8f5]"/><span className="h-[3px] w-14 rounded-full bg-[#e2e9f4]"/></div>
      <p className={'mt-2 break-words text-[#697b94] '+(large?'line-clamp-3 text-xs leading-5':'line-clamp-2 text-[9px] leading-4')}>
        {visit.summary||visit.aiJudgement||'打开搜索记录，查看当时的查询线索'}
      </p>
    </div> : <div className={large?'px-5 pb-7 pt-6':'px-3 pb-5 pt-4'}>
      <div className={'flex items-center gap-2 '+(large?'text-xl':'text-sm')}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eaf1fb] text-[#4b80c4]"><Globe size={17}/></span>
        <strong className="min-w-0 truncate">{host}</strong>
      </div>
      <div className="mt-3 h-[1px] bg-[#e4ebf4]"/>
      <p className={'mt-3 line-clamp-2 font-medium text-[#4b5f79] '+(large?'text-sm':'text-[10px]')}>{browserTitle(visit)}</p>
      <p className="mt-1 truncate text-[9px] text-[#91a0b3]">{visit.url}</p>
      <div className="mt-3 flex gap-1.5"><span className="h-[4px] w-2/3 rounded-full bg-[#e3eaf5]"/><span className="h-[4px] w-1/4 rounded-full bg-[#eef2f8]"/></div>
    </div>}
    <div className="absolute bottom-0 left-0 right-0 flex justify-end bg-gradient-to-t from-white via-white/85 to-transparent px-3 pb-1.5 pt-4">
      <span className="text-[9px] text-[#96a4b6]">记录缩略预览 · 非网页截图</span>
    </div>
  </div>;
}

/** Char's browser history: browse cards, inspect a saved record and verify on the real site. */
export default function CharacterPhoneBrowser({characterId,char,userProfile,groups,realtimeConfig,api}:{
  characterId:string;char:CharacterProfile;userProfile:UserProfile;
  groups:GroupProfile[];realtimeConfig?:RealtimeConfig;api:Api;
}) {
  const [address,setAddress]=useState('');
  const [history,setHistory]=useState<PhoneBrowserVisit[]>(()=>readCharacterPhoneBrowserHistory(characterId));
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [filter,setFilter]=useState<'all'|'char'>('all');
  const [lastUrl,setLastUrl]=useState('');
  const [feedback,setFeedback]=useState('');
  const [generating,setGenerating]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);

  useEffect(()=>{
    setHistory(readCharacterPhoneBrowserHistory(characterId));
    setAddress('');setLastUrl('');setFeedback('');setSelectedId(null);setFilter('all');
    const onChange=(event:Event)=>{
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)
        setHistory(readCharacterPhoneBrowserHistory(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_BROWSER_CHANGED,onChange);
    return()=>window.removeEventListener(CHARACTER_PHONE_BROWSER_CHANGED,onChange);
  },[characterId]);

  const target=useMemo(()=>resolvePhoneBrowserNavigation(address),[address]);
  const selected=history.find(item=>item.id===selectedId);
  const visibleHistory=filter==='char'?history.filter(item=>item.actor==='char'):history;

  const generate=async()=>{
    if(generating)return;
    setFeedback('');setGenerating(true);
    try {
      const result=await runCharacterPhoneBrowserAutonomy({
        char,user:userProfile,groups,realtimeConfig,api,
      },'manual');
      setFeedback(result.status==='generated'
        ? 'Char 新增了 '+result.count+' 条搜索记录'
        : result.reason||'Char 此刻没有想查的新内容');
    } catch (error) {
      setFeedback(error instanceof Error?error.message:'自主搜索失败');
    } finally {setGenerating(false);}
  };

  const openManual=(navigation:NonNullable<ReturnType<typeof resolvePhoneBrowserNavigation>>)=>{
    setFeedback('');
    // A user's real navigation must not be impersonated as Char's search.
    recordPhoneBrowserNavigation(characterId,navigation,'user');
    setLastUrl(navigation.url);
    window.open(navigation.url,'_blank','noopener,noreferrer');
  };

  return <div className="min-h-full bg-[#f5f7fb] pb-12 text-[#283548]">
    <div className="sticky top-0 z-20 border-b border-[#e3eaf4] bg-[#f8faff]/95 px-4 pb-3 pt-4 shadow-[0_5px_18px_rgba(46,78,125,.04)] backdrop-blur-xl">
      <form className="flex h-12 items-center gap-2 rounded-full border border-[#e0e7f2] bg-white px-3 shadow-[0_3px_12px_rgba(40,72,118,.07)]"
        onSubmit={event=>{
          event.preventDefault();
          if(target)openManual(target);
          else setFeedback('请输入有效关键词或 HTTP(S) 网址');
        }}>
        <Globe size={18} className="shrink-0 text-[#4c82c8]"/>
        <input type="search" aria-label="搜索百度或输入网址" autoComplete="off" maxLength={2048}
          value={address} onChange={event=>setAddress(event.target.value)}
          placeholder="搜索或输入网址"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#34445f] outline-none placeholder:text-[#9aa8b9]"/>
        {address&&<button type="button" aria-label="清除搜索输入" onClick={()=>setAddress('')} className="rounded-full p-1 text-[#8494a9]"><X size={15}/></button>}
        <button type="submit" aria-label="前往真实网页" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3377e3] text-white active:scale-95"><ArrowRight size={17}/></button>
      </form>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 rounded-full bg-[#e9eef7] p-[3px]" role="group" aria-label="浏览记录筛选">
          <button type="button" aria-pressed={filter==='all'} onClick={()=>{setSelectedId(null);setFilter('all');}}
            className={'rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all '+(filter==='all'?'bg-white text-[#326dc7] shadow-sm':'text-[#8494aa]')}>全部记录</button>
          <button type="button" aria-pressed={filter==='char'} onClick={()=>{setSelectedId(null);setFilter('char');}}
            className={'rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all '+(filter==='char'?'bg-white text-[#326dc7] shadow-sm':'text-[#8494aa]')}>Char 搜索</button>
        </div>
        <button type="button" disabled={generating} onClick={()=>void generate()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#263c61] px-3 py-2 text-[11px] font-semibold text-white shadow-sm disabled:opacity-50 active:scale-95">
          {generating?<SpinnerGap size={15} className="animate-spin"/>:<Lightning size={15} weight="fill"/>}
          {generating?'搜索中…':'自主搜索'}
        </button>
      </div>
      {feedback&&<p role="status" className="mt-2 rounded-lg bg-[#eaf2ff] px-3 py-2 text-xs leading-5 text-[#466c9f]">{feedback}</p>}
    </div>

    {selected ? <div className="px-4 pt-5">
      <button type="button" onClick={()=>setSelectedId(null)} className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[#5d7ca7]">
        <ArrowLeft size={16}/>返回浏览记录
      </button>
      <div className="overflow-hidden rounded-[22px] border border-[#e4eaf3] bg-white shadow-[0_8px_28px_rgba(50,76,112,.05)]">
        <BrowserRecordPreview visit={selected} large/>
        <div className="space-y-5 p-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-[#8493a7]">
              <ClockCounterClockwise size={14}/>{new Date(selected.visitedAt).toLocaleString('zh-CN')}
              <span className="rounded-full bg-[#eff3f9] px-2 py-0.5">{selected.actor==='char'?'Char 自主搜索':'手动访问'}</span>
            </div>
            <h2 className="break-words text-[19px] font-semibold leading-7 text-[#1d2d45]">{browserTitle(selected)}</h2>
            <p className="mt-2 break-all text-[11px] leading-5 text-[#8294ac]">{selected.url}</p>
          </div>
          {selected.aiJudgement&&<div className="border-l-[3px] border-[#91b3e5] pl-3">
            <h3 className="text-xs font-semibold text-[#6785b0]">当时为什么要查</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#3d4b60]">{selected.aiJudgement}</p>
          </div>}
          {selected.summary&&<div className="rounded-2xl bg-[#f3f7fd] px-4 py-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-[#4f79b4]"><MagnifyingGlass size={15}/>想了解</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#3d506c]">{selected.summary}</p>
          </div>}
          {selected.actor==='char'&&<div className="rounded-2xl border border-[#e9e4f2] bg-[#faf8ff] px-4 py-4">
            <h3 className="text-xs font-semibold text-[#7d6a9d]">搜完后的心声</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#504963]">
              {selected.afterSearchThought||'这条旧记录还没有留下搜索后的想法。'}
            </p>
            {selected.mood&&<p className="mt-3 text-[11px] text-[#9286a7]">当时心情 · {selected.mood}</p>}
          </div>}
          <a href={selected.url} target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3477df] px-4 py-3.5 text-sm font-semibold text-white">
            <ArrowSquareOut size={18}/>打开真实{selected.kind==='baidu-search'?'百度搜索':'网页'}核验
          </a>
          <p className="text-[11px] leading-5 text-[#98a4b5]">这里展示保存的搜索词、动机和角色心声，并非已抓取的网页内容。点击上方按钮才会打开实时网站验证。</p>
        </div>
      </div>
    </div> : <div className="px-4 pt-5">
      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2 text-[#324761]"><ClockCounterClockwise size={19}/><h2 className="text-[16px] font-semibold">浏览记录</h2></div>
          <p className="mt-1 text-[11px] text-[#91a0b3]">{filter==='char'?'角色自己搜过的痕迹':'最近访问 · '+history.length+' 条记录'}</p>
        </div>
        {history.length>0&&<button type="button" onClick={()=>setConfirmClear(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#e0e7f0] bg-white px-3 py-2 text-xs text-[#76879e]">
          <Trash size={14}/>清空
        </button>}
      </div>
      {visibleHistory.length===0 ? <div className="rounded-[22px] border border-dashed border-[#d6e1ef] bg-white px-6 py-14 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eff4fb] text-[#7195c6]"><MagnifyingGlass size={26}/></div>
        <h3 className="mt-4 text-sm font-semibold text-[#415570]">{filter==='char'?'Char 还没有自主搜索':'浏览记录还是空的'}</h3>
        <p className="mt-2 text-xs leading-5 text-[#9aa7b9]">可以在上方输入网址，或让 Char 根据自己的生活决定搜索什么。</p>
      </div> : <div className="grid grid-cols-2 gap-3">
        {visibleHistory.map(item=><article key={item.id} className="min-w-0 overflow-hidden rounded-2xl border border-[#e2e9f2] bg-white shadow-[0_5px_16px_rgba(45,76,119,.045)]">
          <button type="button" onClick={()=>setSelectedId(item.id)}
            aria-label={'查看浏览记录详情：'+browserTitle(item)} className="block w-full text-left active:opacity-75">
            <BrowserRecordPreview visit={item}/>
            <div className="px-3 pb-2 pt-3">
              <strong className="line-clamp-2 min-h-[38px] break-words text-[13px] font-semibold leading-[19px] text-[#2a3b53]">{browserTitle(item)}</strong>
              <p className="mt-1 truncate text-[10px] text-[#7794b9]">{browserHost(item.url)}</p>
              <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[#4780cc]">查看记录 <CaretRight size={12}/></span>
            </div>
          </button>
          <div className="flex items-center justify-between gap-1 border-t border-[#f1f3f8] px-3 py-2">
            <span className="min-w-0 truncate text-[10px] text-[#96a4b7]">{visitTime(item)} · {item.actor==='char'?'Char':'手动'}</span>
            <button type="button" aria-label={'删除记录 '+browserTitle(item)}
              onClick={()=>deletePhoneBrowserVisit(characterId,item.id)}
              className="shrink-0 rounded-md p-1 text-[#9ca8b8] active:text-[#e15f5f]"><Trash size={15}/></button>
          </div>
        </article>)}
      </div>}
      {lastUrl&&<p className="mt-5 break-all text-[11px] leading-5 text-[#8494a9]">最近手动打开：<a href={lastUrl} target="_blank" rel="noopener noreferrer" className="text-[#4a82d2] underline">{lastUrl}</a></p>}
      <p className="mt-6 px-1 text-[11px] leading-5 text-[#97a4b5]">
        缩略卡片由实际保存的搜索词、网址和角色笔记组成；没有抓取网页截图或冒充实时结果。点开记录后可查看心声，并前往真实网页核验。
      </p>
    </div>}

    {confirmClear&&<div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 p-2"
      role="dialog" aria-modal="true" aria-label="清空浏览记录" onClick={()=>setConfirmClear(false)}>
      <div className="w-full max-w-[420px] rounded-3xl bg-white p-6" onClick={event=>event.stopPropagation()}>
        <h3 className="font-semibold">清空这位 Char 的浏览历史？</h3>
        <p className="mt-2 text-sm text-[#888]">只清除此角色的网页记录，不改其他角色或实际浏览器历史。</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className="rounded-xl bg-[#eee] py-3" onClick={()=>setConfirmClear(false)}>取消</button>
          <button type="button" className="rounded-xl bg-[#333] py-3 text-white" onClick={()=>{
            try{clearPhoneBrowserHistory(characterId);setSelectedId(null);setConfirmClear(false);}
            catch{setFeedback('清空失败，请稍后重试');}
          }}>确认清空</button>
        </div>
      </div>
    </div>}
  </div>;
}
