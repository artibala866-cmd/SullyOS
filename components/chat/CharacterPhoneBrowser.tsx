import React, { useEffect, useMemo, useState } from 'react';
import { ArrowSquareOut, ClockCounterClockwise, Globe, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import {
  CHARACTER_PHONE_BROWSER_CHANGED, clearPhoneBrowserHistory,
  deletePhoneBrowserVisit, readCharacterPhoneBrowserHistory,
  recordPhoneBrowserNavigation, resolvePhoneBrowserNavigation,
  type PhoneBrowserVisit,
} from '../../utils/characterPhoneBrowser';

function browserTitle(visit: PhoneBrowserVisit): string {
  if (visit.kind === 'baidu-search') return visit.query;
  try {return new URL(visit.url).hostname;} catch {return visit.url;}
}

/** Real Baidu navigation. Many websites block third-party iframe embeds, so
 * direct external navigation is always available rather than showing a fake
 * search result or an indefinitely blank in-phone iframe.
 */
export default function CharacterPhoneBrowser({characterId}: {characterId:string}) {
  const [address,setAddress]=useState('');
  const [history,setHistory]=useState<PhoneBrowserVisit[]>(() => readCharacterPhoneBrowserHistory(characterId));
  const [lastUrl,setLastUrl]=useState('');
  const [feedback,setFeedback]=useState('');
  const [confirmClear,setConfirmClear]=useState(false);
  useEffect(()=>{
    setHistory(readCharacterPhoneBrowserHistory(characterId));setAddress('');setLastUrl('');setFeedback('');
    const onChange=(event:Event)=>{
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)
        setHistory(readCharacterPhoneBrowserHistory(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_BROWSER_CHANGED,onChange);
    return ()=>window.removeEventListener(CHARACTER_PHONE_BROWSER_CHANGED,onChange);
  },[characterId]);

  const target = useMemo(()=>resolvePhoneBrowserNavigation(address),[address]);

  const open = (navigation: NonNullable<ReturnType<typeof resolvePhoneBrowserNavigation>>) => {
    setFeedback('');
    // Explicit User action: the search goes to real Baidu, not AI-generated
    // snippets. No User click is recorded as autonomous Char browsing.
    try {
      recordPhoneBrowserNavigation(characterId,navigation,'user');
      setLastUrl(navigation.url);
      const opened = window.open(navigation.url,'_blank','noopener,noreferrer');
      // With noopener some browsers return null even on success; always leave
      // a real anchor visible so popup blockers and Android browsers can retry.
      if (!opened) setFeedback('如未打开网页，请点下方「打开真实网页」链接');
    } catch {setLastUrl(navigation.url);setFeedback('未能保存历史记录，可用下方链接直接访问网页');}
  };

  return <div className="min-h-full bg-[#f3f3f3] pb-10 text-[#292929]">
    <div className="px-5 pb-5 pt-8">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm"><Globe size={30} weight="light"/></div>
      <h2 className="mt-4 text-center text-2xl font-semibold tracking-[.18em]">百度</h2>
      <p className="mt-2 text-center text-xs text-[#929292]">搜索真实互联网 · 打开百度官方网页</p>
    </div>
    <form className="mx-4 flex items-center gap-2 rounded-2xl border border-[#ddd] bg-white px-4 py-2 shadow-sm" onSubmit={e=>{
      e.preventDefault();
      if(target) open(target);
      else setFeedback('请输入要搜索的内容或 http(s) 网页地址');
    }}>
      <MagnifyingGlass size={20} className="shrink-0 text-[#888]"/>
      <input aria-label="百度搜索或输入网址" autoComplete="off" type="search"
        className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
        placeholder="百度一下 / 输入网址" maxLength={2048}
        value={address} onChange={e=>{setAddress(e.target.value);setFeedback('');}}/>
      <button type="submit" className="shrink-0 rounded-xl bg-[#333] px-4 py-2 text-xs text-white">前往</button>
    </form>
    {feedback && <p role="status" className="mx-6 mt-3 text-xs leading-5 text-[#777]">{feedback}</p>}
    {lastUrl && <a className="mx-5 mt-3 flex items-center justify-center gap-2 rounded-xl border border-[#dedede] bg-white py-3 text-sm"
      href={lastUrl} target="_blank" rel="noopener noreferrer"
      onClick={()=>{const nav=resolvePhoneBrowserNavigation(lastUrl);if(nav)recordPhoneBrowserNavigation(characterId,nav,'user');}}>
      <ArrowSquareOut size={17}/> 打开真实网页
    </a>}

    <section className="mx-4 mt-8 overflow-hidden rounded-2xl bg-white">
      <h3 className="border-b border-[#eee] px-4 py-3 text-sm font-semibold">快捷访问</h3>
      <a href="https://www.baidu.com/" target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-3 px-4 py-4 text-sm" onClick={()=>{
          recordPhoneBrowserNavigation(characterId,{url:'https://www.baidu.com/',kind:'open-url',query:''},'user');
        }}>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eee]"><Globe size={20}/></span>
        <span className="flex-1">百度首页</span><ArrowSquareOut size={16} className="text-[#aaa]"/>
      </a>
    </section>

    <section className="mx-4 mt-6 overflow-hidden rounded-2xl bg-white">
      <div className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
        <div className="flex items-center gap-2"><ClockCounterClockwise size={18}/><h3 className="text-sm font-semibold">浏览记录</h3></div>
        {history.length>0 && <button aria-label="清空浏览记录" type="button" className="text-xs text-[#888]" onClick={()=>setConfirmClear(true)}>清空</button>}
      </div>
      {!history.length && <div className="px-5 py-10 text-center text-sm text-[#aaa]">暂无浏览记录</div>}
      {history.map(item=><div key={item.id} className="flex items-center gap-2 border-b border-[#eee] px-4 py-3 last:border-none">
        <a className="min-w-0 flex-1" href={item.url} target="_blank" rel="noopener noreferrer"
          onClick={()=>recordPhoneBrowserNavigation(characterId,{
            url:item.url, kind:item.kind, query:item.query,
          },'user')}>
          <span className="block truncate text-sm font-medium">{browserTitle(item)}</span>
          <span className="mt-1 block truncate text-xs text-[#999]">
            {new Date(item.visitedAt).toLocaleString('zh-CN')} · {item.kind==='baidu-search'?'百度搜索':'网页访问'}
          </span>
        </a>
        <button type="button" className="rounded-lg p-2 text-[#999]" aria-label={'删除记录 '+browserTitle(item)}
          onClick={()=>deletePhoneBrowserVisit(characterId,item.id)}><Trash size={17}/></button>
      </div>)}
    </section>
    <p className="mx-6 mt-6 text-xs leading-6 text-[#999]">访问真实网站时会切换到浏览器标签页。百度等网站可能禁止嵌入第三方页面，因此不使用假的站内搜索结果。这里保存的是你打开 Char 手机时的访问记录，不会冒充 Char 自己的经历，也不会写进记忆宫殿。</p>
    {confirmClear && <div className="fixed inset-0 z-[1300] flex items-end justify-center bg-black/40 p-2" role="dialog" aria-modal="true" aria-label="清空浏览记录" onClick={()=>setConfirmClear(false)}>
      <div className="w-full max-w-[420px] rounded-3xl bg-white p-6" onClick={e=>e.stopPropagation()}>
        <h3 className="font-semibold">清空浏览记录？</h3>
        <p className="mt-2 text-sm text-[#888]">仅清空此角色手机的访问记录，不影响真实浏览器或其他角色。</p>
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" className="rounded-xl bg-[#eee] py-3" onClick={()=>setConfirmClear(false)}>取消</button>
          <button type="button" className="rounded-xl bg-[#333] py-3 text-white" onClick={()=>{
            try{clearPhoneBrowserHistory(characterId);setConfirmClear(false);}
            catch{setFeedback('清空失败，请稍后重试');}
          }}>确认清空</button></div>
      </div>
    </div>}
  </div>;
}
