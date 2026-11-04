import React, {useEffect, useMemo, useState} from 'react';
import {
  ArrowLeft, ArrowRight, ArrowSquareOut, CaretRight, ClockCounterClockwise,
  Books, Cookie, GameController, Globe, GraduationCap, Lightning,
  MagnifyingGlass, MusicNotes, PaintBrush, SpinnerGap, Trash, X,
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

/** Topic artwork derived from the SAVED query: never a fake web screenshot. */
function searchRecordTheme(visit:PhoneBrowserVisit) {
  const query=[visit.query,visit.title,visit.summary].filter(Boolean).join(' ');
  if(/曲奇|面团|烤|烘焙|饼干|蛋糕|食谱|做饭/.test(query))
    return {name:'生活 · 美食',icon:Cookie,background:'linear-gradient(140deg,#ffefe0,#f5d4b4)',color:'#98623e'};
  if(/游戏|steam|ps5|主机|通关|单机/i.test(query))
    return {name:'娱乐 · 游戏',icon:GameController,background:'linear-gradient(145deg,#e5ecff,#cfdcf5)',color:'#5b6ba4'};
  if(/课|课程|学习|考试|人体|价格|行情|老师|练习/.test(query))
    return {name:'学习 · 资料',icon:GraduationCap,background:'linear-gradient(150deg,#e0f1e7,#bfdacb)',color:'#4f8169'};
  if(/绘画|插画|画笔|美术|设计|色彩/.test(query))
    return {name:'创作 · 灵感',icon:PaintBrush,background:'linear-gradient(150deg,#fae9ef,#eecdd9)',color:'#a96781'};
  if(/歌|音乐|听歌|专辑|旋律/.test(query))
    return {name:'影音 · 音乐',icon:MusicNotes,background:'linear-gradient(145deg,#eee7f6,#d8c8e8)',color:'#816a99'};
  if(/读书|小说|文学|书籍|作者|出版社/.test(query))
    return {name:'阅读 · 书籍',icon:Books,background:'linear-gradient(145deg,#f4ebdc,#e5d2b1)',color:'#957951'};
  return {name:visit.kind==='baidu-search'?'网络 · 搜索':'网页 · 浏览',icon:Globe,
    background:'linear-gradient(145deg,#e9eef6,#d0dce9)',color:'#617f9d'};
}
function BrowserRecordPreview({visit,large=false}:{visit:PhoneBrowserVisit;large?:boolean}) {
  const theme=searchRecordTheme(visit);
  const CoverIcon=theme.icon;
  return <div aria-label={large?'记录封面':'搜索记录图文封面'}
    className={'relative isolate flex shrink-0 flex-col overflow-hidden '+(large?'h-[196px] w-full':'w-[116px] min-h-[170px] self-stretch')}
    style={{background:theme.background,color:theme.color}}>
    <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-9 h-32 w-32 rounded-full border-[14px] border-white/35"/>
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-12 -left-10 h-36 w-36 rounded-full border-[12px] border-white/30"/>
    <div className={'relative z-10 flex items-center gap-1.5 '+(large?'px-5 pt-5':'px-3 pt-3')}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-75"/>
      <span className={'font-semibold tracking-wide '+(large?'text-[11px]':'text-[9px]')}>
        {visit.kind==='baidu-search'?'百度 · 搜索':'网站 · 浏览'}
      </span>
    </div>
    <div className="relative z-10 flex flex-1 items-center justify-center py-1">
      <div className={'flex items-center justify-center border border-white/50 bg-white/50 shadow-[0_10px_22px_rgba(0,0,0,.05)] '+(large?'h-[79px] w-[79px] rounded-[24px]':'h-[64px] w-[64px] rounded-[20px]')}>
        <CoverIcon size={large?46:37} weight="duotone"/>
      </div>
    </div>
    <div className={'relative z-10 '+(large?'px-5 pb-5':'px-2.5 pb-3')}>
      <span className={'block font-semibold '+(large?'text-xs':'text-[9px]')}>{theme.name}</span>
      <span className={'mt-1 block break-words font-semibold leading-snug '+(large?'line-clamp-2 text-[17px]':'line-clamp-2 text-[10px]')}>
        {visit.query||browserTitle(visit)}
      </span>
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
        <div className="space-y-4 p-4.5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] text-[#8493a7]">
              <ClockCounterClockwise size={14}/>{new Date(selected.visitedAt).toLocaleString('zh-CN')}
              <span className="rounded-full bg-[#eff3f9] px-2 py-0.5">{selected.actor==='char'?'Char 自主搜索':'手动访问'}</span>
            </div>
            <h2 className="break-words text-[19px] font-semibold leading-7 text-[#1d2d45]">{browserTitle(selected)}</h2>
            <p className="mt-2 truncate rounded-lg bg-[#f5f7fa] px-3 py-2 text-[11px] text-[#8294ac]" title={selected.url}>{browserHost(selected.url)} · {selected.kind==='baidu-search'?'搜索词已保存':selected.url}</p>
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
      </div> : <div className="space-y-3">
        {visibleHistory.map(item=><article key={item.id}
          className="overflow-hidden rounded-[20px] border border-[#e4e9f0] bg-white shadow-[0_5px_16px_rgba(36,56,85,.045)]">
          <button type="button" onClick={()=>setSelectedId(item.id)}
            aria-label={'查看浏览记录详情：'+browserTitle(item)}
            className="flex w-full items-stretch text-left active:opacity-75">
            <BrowserRecordPreview visit={item}/>
            <div className="flex min-w-0 flex-1 flex-col px-3.5 py-3.5">
              <div className="mb-2 flex items-center justify-between gap-1.5 text-[10px] text-[#92a0b3]">
                <span className="inline-flex items-center gap-1 truncate"><MagnifyingGlass size={12} className="shrink-0"/>
                  {item.actor==='char'?'Char 搜索':'手动浏览'}</span>
                <CaretRight size={15} className="shrink-0 text-[#aab8ca]"/>
              </div>
              <h3 className="line-clamp-2 break-words text-[15px] font-semibold leading-[21px] text-[#29364a]">{browserTitle(item)}</h3>
              <p className="mt-2 line-clamp-2 break-words text-[12px] leading-[18px] text-[#718197]">
                <span className="mr-1 font-semibold text-[#536780]">想了解</span>
                {item.summary||item.query||browserHost(item.url)}
              </p>
              {item.afterSearchThought&&<p className="mt-2 line-clamp-2 break-words rounded-lg bg-[#f7f5fa] px-2 py-1.5 text-[11px] leading-[17px] text-[#85738f]">
                <span className="font-semibold">心声 · </span>{item.afterSearchThought}
              </p>}
              <span className="mt-auto pt-2 text-[10px] text-[#9ca8b6]">{visitTime(item)}</span>
            </div>
          </button>
          <div className="flex items-center justify-between border-t border-[#f0f2f5] px-3.5 py-2">
            <span className="truncate text-[10px] text-[#8b9aaa]">{browserHost(item.url)} · 搜索记录预览</span>
            <button type="button" aria-label={'删除记录 '+browserTitle(item)} onClick={()=>deletePhoneBrowserVisit(characterId,item.id)}
              className="rounded-md p-1 text-[#9ca8b8] active:text-[#e15f5f]"><Trash size={15}/></button>
          </div>
        </article>)}
      </div>}
      {lastUrl&&<p className="mt-5 break-all text-[11px] leading-5 text-[#8494a9]">最近手动打开：<a href={lastUrl} target="_blank" rel="noopener noreferrer" className="text-[#4a82d2] underline">{lastUrl}</a></p>}
      <p className="mt-6 px-1 text-[11px] leading-5 text-[#97a4b5]">
        卡片直接展示已保存的搜索主题、想了解的内容及心声摘录，配图是主题插画而非网页截图。点开后查看完整记录，再到真实网页核验。
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
