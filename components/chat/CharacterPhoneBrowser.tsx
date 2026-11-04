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

/** Miniature Baidu-style search history view built strictly from saved search metadata,
 * never from invented web result titles or snapshots.
 */
function BrowserRecordPreview({visit,large=false}:{visit:PhoneBrowserVisit;large?:boolean}) {
  const baidu=visit.kind==='baidu-search';
  const title=browserTitle(visit);
  const snippet=visit.summary||visit.aiJudgement||visit.query||visit.url;
  return <div aria-label={large?'记录封面':'搜索记录图文封面'}
    className={'flex shrink-0 flex-col overflow-hidden border-[#ededed] bg-white '+(large?'h-[168px] w-full border-b':'w-[132px] min-h-[174px] self-stretch border-r')}>
    <div className={'flex items-center justify-between border-b border-[#f0f0f0] '+(large?'px-4 py-2':'px-2 py-1.5')}>
      <span className={'min-w-0 truncate font-medium text-[#919191] '+(large?'text-[11px]':'text-[8px]')}>{baidu?'www.baidu.com':browserHost(visit.url)}</span>
      <span aria-hidden="true" className="ml-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-[#d3d3d3]"/>
    </div>
    <div className={'flex min-h-0 flex-1 flex-col '+(large?'px-5 pb-3 pt-2':'px-2.5 pb-2 pt-2')}>
      {baidu ? <>
        <div className={'flex items-center font-bold tracking-tight '+(large?'text-[22px]':'text-[15px]')}>
          <span className="text-[#3269dc]">百</span><span className="text-[#ef4e41]">度</span>
          <span className={'ml-1 font-medium text-[#888] '+(large?'text-[10px]':'text-[8px]')}>一下</span>
        </div>
        <div className={'mt-1.5 flex items-center overflow-hidden rounded-[5px] border border-[#d5d8df] bg-[#fcfcfd] '+(large?'h-8':'h-6')}>
          <span className={'min-w-0 flex-1 truncate px-1.5 text-[#444] '+(large?'text-[12px]':'text-[9px]')}>{visit.query}</span>
          <span className={'flex h-full shrink-0 items-center justify-center bg-[#3478e5] text-white '+(large?'w-12':'w-6')}>
            <MagnifyingGlass size={large?15:11}/>
          </span>
        </div>
        <div className={'flex shrink-0 items-center gap-3 border-b border-[#eceef3] text-[#a0a0a0] '+(large?'mt-2 pb-1.5 text-[10px]':'mt-1.5 pb-1 text-[8px]')}>
          <span className="border-b border-[#3478e5] pb-0.5 font-semibold text-[#3478e5]">网页</span>
          <span>图片</span><span>视频</span>
        </div>
      </> : <div className={'mb-2 flex items-center gap-1.5 font-semibold text-[#333] '+(large?'text-lg':'text-xs')}>
        <Globe size={large?21:15} className="text-[#767676]"/>
        <span className="min-w-0 truncate">{browserHost(visit.url)}</span>
      </div>}
      <div className={'min-h-0 '+(large?'mt-2':'mt-1.5')}>
        <p className={'line-clamp-2 break-words font-medium leading-snug text-[#245baf] '+(large?'text-[14px]':'text-[10px]')}>{title}</p>
        <p className={'mt-1 line-clamp-2 break-words leading-snug text-[#767676] '+(large?'text-[11px]':'text-[8px]')}>{snippet}</p>
      </div>
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

  return <div className="min-h-full bg-[#f6f6f6] pb-8 text-[#272727]">
    <div className="sticky top-0 z-20 border-b border-[#ececec] bg-white px-4 pb-3 pt-4">
      <form className="flex h-11 items-center gap-2 rounded-[13px] border border-[#e3e3e3] bg-[#f8f8f8] px-3"
        onSubmit={event=>{
          event.preventDefault();
          if(target)openManual(target);
          else setFeedback('请输入有效关键词或 HTTP(S) 网址');
        }}>
        <MagnifyingGlass size={18} className="shrink-0 text-[#929292]"/>
        <input type="search" aria-label="搜索百度或输入网址" autoComplete="off" maxLength={2048}
          value={address} onChange={event=>setAddress(event.target.value)}
          placeholder="搜索或输入网址"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#333] outline-none placeholder:text-[#aaa]"/>
        {address&&<button type="button" aria-label="清除搜索输入" onClick={()=>setAddress('')} className="rounded-full p-1 text-[#8494a9]"><X size={15}/></button>}
        <button type="submit" aria-label="前往真实网页" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#3479e7] text-white active:scale-95"><ArrowRight size={17}/></button>
      </form>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 gap-1" role="group" aria-label="浏览记录筛选">
          <button type="button" aria-pressed={filter==='all'} onClick={()=>{setSelectedId(null);setFilter('all');}}
            className={'rounded-[9px] px-3 py-2 text-[11px] font-medium transition-all '+(filter==='all'?'bg-[#f1f1f1] text-[#262626]':'text-[#999]')}>全部记录</button>
          <button type="button" aria-pressed={filter==='char'} onClick={()=>{setSelectedId(null);setFilter('char');}}
            className={'rounded-[9px] px-3 py-2 text-[11px] font-medium transition-all '+(filter==='char'?'bg-[#f1f1f1] text-[#262626]':'text-[#999]')}>Char 搜索</button>
        </div>
        <button type="button" disabled={generating} onClick={()=>void generate()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] bg-[#303030] px-3 py-2 text-[11px] font-medium text-white disabled:opacity-50 active:scale-95">
          {generating?<SpinnerGap size={15} className="animate-spin"/>:<Lightning size={15} weight="fill"/>}
          {generating?'搜索中…':'自主搜索'}
        </button>
      </div>
      {feedback&&<p role="status" className="mt-2 rounded-lg bg-[#f3f3f3] px-3 py-2 text-xs leading-5 text-[#555]">{feedback}</p>}
    </div>

    {selected ? <div className="px-4 pt-5">
      <button type="button" onClick={()=>setSelectedId(null)} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#666]">
        <ArrowLeft size={16}/>返回浏览记录
      </button>
      <div className="overflow-hidden rounded-[16px] border border-[#e9e9e9] bg-white">
        <BrowserRecordPreview visit={selected} large/>
        <div className="space-y-4 p-4">
          <div>
            <div data-testid="phone-browser-visit-meta" className="mb-2 flex items-center gap-2 text-[11px] text-[#969696]">
              <ClockCounterClockwise size={14}/>{new Date(selected.visitedAt).toLocaleString('zh-CN')}
              <span className="rounded-[6px] bg-[#f1f1f1] px-2 py-0.5">{selected.actor==='char'?'Char 自主搜索':'手动访问'}</span>
            </div>
            <h2 className="break-words text-[18px] font-semibold leading-7 text-[#252525]">{browserTitle(selected)}</h2>
            <p className="mt-2 truncate rounded-lg bg-[#f7f7f7] px-3 py-2 text-[11px] text-[#888]" title={selected.url}>{browserHost(selected.url)} · {selected.kind==='baidu-search'?'搜索词已保存':selected.url}</p>
          </div>
          {selected.aiJudgement&&<div className="border-l-2 border-[#dadada] pl-3">
            <h3 className="text-xs font-semibold text-[#777]">当时为什么要查</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#404040]">{selected.aiJudgement}</p>
          </div>}
          {selected.summary&&<div className="rounded-[12px] bg-[#f7f7f7] px-4 py-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-[#555]"><MagnifyingGlass size={15}/>想了解</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#444]">{selected.summary}</p>
          </div>}
          {selected.actor==='char'&&<div className="rounded-[12px] bg-[#f7f7f7] px-4 py-3">
            <h3 className="text-xs font-semibold text-[#666]">搜完后的心声</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#444]">
              {selected.afterSearchThought||'这条旧记录还没有留下搜索后的想法。'}
            </p>
            {selected.mood&&<p className="mt-2 text-[11px] text-[#999]">当时心情 · {selected.mood}</p>}
          </div>}
          <a data-testid="phone-browser-verify-link" href={selected.url} target="_blank" rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#343434] px-4 py-3 text-sm font-medium text-white">
            <ArrowSquareOut size={18}/>打开真实{selected.kind==='baidu-search'?'百度搜索':'网页'}核验
          </a>

        </div>
      </div>
    </div> : <div className="px-4 pt-5">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div>
          <div className="flex items-center gap-2 text-[#333]"><ClockCounterClockwise size={17}/><h2 className="text-[15px] font-semibold">浏览记录</h2></div>
          <p className="mt-1 text-[11px] text-[#999]">{filter==='char'?'角色的搜索记录':'最近访问 · '+history.length+' 条'}</p>
        </div>
        {history.length>0&&<button type="button" onClick={()=>setConfirmClear(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8e8e8] bg-white px-3 py-2 text-xs text-[#888]">
          <Trash size={14}/>清空
        </button>}
      </div>
      {visibleHistory.length===0 ? <div className="rounded-[22px] border border-dashed border-[#d6e1ef] bg-white px-6 py-14 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eff4fb] text-[#7195c6]"><MagnifyingGlass size={26}/></div>
        <h3 className="mt-4 text-sm font-semibold text-[#415570]">{filter==='char'?'Char 还没有自主搜索':'浏览记录还是空的'}</h3>
        <p className="mt-2 text-xs leading-5 text-[#9aa7b9]">可以在上方输入网址，或让 Char 根据自己的生活决定搜索什么。</p>
      </div> : <div className="space-y-2.5">
        {visibleHistory.map(item=><article key={item.id}
          className="overflow-hidden rounded-[15px] border border-[#e8e8e8] bg-white">
          <button type="button" onClick={()=>setSelectedId(item.id)}
            aria-label={'查看浏览记录详情：'+browserTitle(item)}
            className="flex w-full items-stretch text-left active:bg-[#fafafa]">
            <BrowserRecordPreview visit={item}/>
            <div className="flex min-w-0 flex-1 flex-col px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-1.5 text-[10px] text-[#929292]">
                <span className="inline-flex items-center gap-1 truncate">{item.actor==='char'?'Char 搜索':'手动访问'}</span>
                <CaretRight size={15} className="shrink-0 text-[#a6a6a6]"/>
              </div>
              <h3 className="line-clamp-2 break-words text-[14px] font-semibold leading-[20px] text-[#262626]">{browserTitle(item)}</h3>
              <p className="mt-2 line-clamp-2 break-words text-[11px] leading-[17px] text-[#666]">
                <span className="mr-1 font-semibold text-[#555]">想了解</span>{item.summary||item.query||browserHost(item.url)}
              </p>
              {item.afterSearchThought&&<p className="mt-2 line-clamp-2 break-words text-[11px] leading-[17px] text-[#8a8a8a]">
                <span className="font-semibold">心声 · </span>{item.afterSearchThought}
              </p>}
              <span className="mt-auto pt-1.5 text-[10px] text-[#aaa]">{visitTime(item)}</span>
            </div>
          </button>
          <div className="flex items-center justify-between border-t border-[#f1f1f1] px-3 py-1.5">
            <span className="min-w-0 truncate text-[10px] text-[#999]">{browserHost(item.url)}</span>
            <button type="button" aria-label={'删除记录 '+browserTitle(item)}
              onClick={()=>deletePhoneBrowserVisit(characterId,item.id)}
              className="rounded-md p-1 text-[#999] active:text-[#b55]"><Trash size={15}/></button>
          </div>
        </article>)}
      </div>}
      {lastUrl&&<p className="mt-5 break-all text-[11px] leading-5 text-[#8494a9]">最近手动打开：<a href={lastUrl} target="_blank" rel="noopener noreferrer" className="text-[#4a82d2] underline">{lastUrl}</a></p>}

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
