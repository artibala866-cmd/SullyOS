import React, { useEffect, useMemo, useState } from 'react';
import { ArrowSquareOut, ClockCounterClockwise, Globe, MagnifyingGlass, SpinnerGap, Trash } from '@phosphor-icons/react';
import type { CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../types';
import {
  CHARACTER_PHONE_BROWSER_CHANGED, clearPhoneBrowserHistory,
  deletePhoneBrowserVisit, readCharacterPhoneBrowserHistory,
  recordPhoneBrowserNavigation, resolvePhoneBrowserNavigation,
  type PhoneBrowserVisit,
} from '../../utils/characterPhoneBrowser';
import { runCharacterPhoneBrowserAutonomy } from '../../utils/characterPhoneBrowserAutonomy';

type Api = {baseUrl:string;apiKey:string;model:string};
function browserTitle(visit: PhoneBrowserVisit): string {
  if (visit.title) return visit.title;
  if (visit.kind === 'baidu-search') return visit.query;
  try {return new URL(visit.url).hostname;} catch {return visit.url;}
}

/** Char's browser. AI-generated searches are owner decisions grounded in
 * private chat, mood, scheduled context and saved events; their Baidu URLs
 * open real search pages, but are not claimed to have fetched actual results.
 */
export default function CharacterPhoneBrowser({ characterId, char, userProfile, groups, realtimeConfig, api }: {
  characterId:string;char:CharacterProfile;userProfile:UserProfile;
  groups:GroupProfile[];realtimeConfig?:RealtimeConfig;api:Api;
}) {
  const [address,setAddress]=useState('');
  const [history,setHistory]=useState<PhoneBrowserVisit[]>(()=>readCharacterPhoneBrowserHistory(characterId));
  const [lastUrl,setLastUrl]=useState('');
  const [feedback,setFeedback]=useState('');
  const [generating,setGenerating]=useState(false);
  const [confirmClear,setConfirmClear]=useState(false);
  const [showManual,setShowManual]=useState(false);
  useEffect(()=>{
    setHistory(readCharacterPhoneBrowserHistory(characterId));
    setAddress('');setLastUrl('');setFeedback('');
    const onChange=(event:Event)=>{
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)
        setHistory(readCharacterPhoneBrowserHistory(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_BROWSER_CHANGED,onChange);
    return()=>window.removeEventListener(CHARACTER_PHONE_BROWSER_CHANGED,onChange);
  },[characterId]);
  const target=useMemo(()=>resolvePhoneBrowserNavigation(address),[address]);
  const generate=async()=>{
    if(generating)return;
    setFeedback('');setGenerating(true);
    try {
      const result=await runCharacterPhoneBrowserAutonomy({
        char,user:userProfile,groups,realtimeConfig,api,
      },'manual');
      setFeedback(result.status==='generated'
        ? 'Char 根据自己的近况留下 '+result.count+' 条搜索记录'
        : result.reason||'Char 此刻没有想查的新内容');
    } finally {setGenerating(false);}
  };
  const openManual=(navigation:NonNullable<ReturnType<typeof resolvePhoneBrowserNavigation>>)=>{
    setFeedback('');
    // Manual inspector actions remain separate from Char's AI activity.
    recordPhoneBrowserNavigation(characterId,navigation,'user');
    setLastUrl(navigation.url);
    window.open(navigation.url,'_blank','noopener,noreferrer');
  };
  return <div className="min-h-full bg-[#f2f2f2] pb-10 text-[#292929]">
    <section className="px-5 pb-5 pt-7">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
        <Globe size={30} weight="light"/>
      </div>
      <h2 className="mt-4 text-center text-xl font-semibold tracking-[.09em]">{char.name}的浏览器</h2>
      <p className="mt-2 text-center text-xs text-[#929292]">Char 自己查过什么 · 当时为什么查</p>
      <button type="button" disabled={generating} onClick={()=>void generate()}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#292929] py-3 text-sm text-white disabled:opacity-50">
        {generating&&<SpinnerGap size={17} className="animate-spin"/>}
        {generating?'Char 正在考虑搜什么…':'让 Char 自主搜索'}
      </button>
      {feedback && <p role="status" className="mt-3 text-center text-xs leading-5 text-[#666]">{feedback}</p>}
    </section>

    <section className="mx-4 overflow-hidden rounded-2xl bg-white">
      <div className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
        <div className="flex items-center gap-2"><ClockCounterClockwise size={19}/><h3 className="text-sm font-semibold">浏览历史</h3></div>
        {history.length>0&&<button type="button" onClick={()=>setConfirmClear(true)} className="text-xs text-[#888]">清空</button>}
      </div>
      {!history.length&&<div className="px-5 py-11 text-center text-sm text-[#999]">
        还没有搜索痕迹，Char 可以根据自己的生活主动搜索
      </div>}
      {history.map(item=><article key={item.id} className="border-b border-[#eee] px-4 py-4 last:border-none">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#ededed]">
            <MagnifyingGlass size={19} weight="regular"/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <strong className="break-words text-sm leading-6">{browserTitle(item)}</strong>
              <button type="button" className="shrink-0 rounded-lg p-1 text-[#aaa]"
                aria-label={'删除记录 '+browserTitle(item)} onClick={()=>deletePhoneBrowserVisit(characterId,item.id)}>
                <Trash size={17}/>
              </button>
            </div>
            <p className="mt-1 text-xs text-[#999]">
              {new Date(item.visitedAt).toLocaleString('zh-CN')} ·
              {item.actor==='char'?' Char 搜索':' 手动访问'}
            </p>
            {item.query&&<p className="mt-2 text-xs text-[#555]">搜索：{item.query}</p>}
            {item.aiJudgement&&<div className="mt-3 rounded-xl bg-[#f5f5f5] px-3 py-3">
              <p className="text-[11px] text-[#999]">Char 当时为什么这样查</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#444]">{item.aiJudgement}</p>
              {item.mood&&<p className="mt-2 text-xs text-[#888]">当时心情：{item.mood}</p>}
            </div>}
            {item.summary&&<div className="mt-2 text-xs leading-6 text-[#777]">
              想了解：{item.summary}
            </div>}
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#ddd] px-3 py-2 text-xs text-[#555]">
              <ArrowSquareOut size={15}/>查看实时{item.kind==='baidu-search'?'百度搜索':'网页'}
            </a>
          </div>
        </div>
      </article>)}
    </section>

    <section className="mx-4 mt-5 overflow-hidden rounded-2xl bg-white">
      <button type="button" className="flex w-full items-center justify-between px-4 py-4 text-sm"
        onClick={()=>setShowManual(v=>!v)}>
        <span>手动打开网页</span><span className="text-[#aaa]">{showManual?'收起':'展开'}</span>
      </button>
      {showManual&&<div className="border-t border-[#eee] p-4">
        <form className="flex items-center gap-2 rounded-xl bg-[#f2f2f2] px-3 py-2" onSubmit={e=>{
          e.preventDefault();
          if(target)openManual(target);
          else setFeedback('请输入有效关键词或 HTTP(S) 网址');
        }}>
          <MagnifyingGlass size={18} className="shrink-0 text-[#888]"/>
          <input type="search" aria-label="手动搜索百度或输入网址" autoComplete="off" maxLength={2048}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
            placeholder="百度搜索 / 输入网址" value={address} onChange={e=>setAddress(e.target.value)}/>
          <button type="submit" className="rounded-lg bg-[#333] px-3 py-2 text-xs text-white">前往</button>
        </form>
        {lastUrl&&<a className="mt-3 block truncate text-xs text-[#666]" href={lastUrl}
          target="_blank" rel="noopener noreferrer">打开上次查询链接</a>}
        <p className="mt-2 text-xs leading-5 text-[#999]">这属于你手动查看，不会伪装成 Char 自己搜索。</p>
      </div>}
    </section>
    <p className="mx-6 mt-6 text-xs leading-6 text-[#999]">
      搜索词、动机和心情来自 Char 的 AI 角色生活；实际网页由百度实时提供。
      在没有网页读取接口的情况下，不会虚构 Char 已看过的搜索结果或网页正文。
    </p>

    {confirmClear&&<div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 p-2"
      role="dialog" aria-modal="true" aria-label="清空浏览记录" onClick={()=>setConfirmClear(false)}>
      <div className="w-full max-w-[420px] rounded-3xl bg-white p-6" onClick={e=>e.stopPropagation()}>
        <h3 className="font-semibold">清空这位 Char 的浏览历史？</h3>
        <p className="mt-2 text-sm text-[#888]">只清除此角色的网页记录，不改其他角色或实际浏览器历史。</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className="rounded-xl bg-[#eee] py-3" onClick={()=>setConfirmClear(false)}>取消</button>
          <button type="button" className="rounded-xl bg-[#333] py-3 text-white" onClick={()=>{
            try{clearPhoneBrowserHistory(characterId);setConfirmClear(false);}
            catch{setFeedback('清空失败，请稍后重试');}
          }}>确认清空</button>
        </div>
      </div>
    </div>}
  </div>;
}
