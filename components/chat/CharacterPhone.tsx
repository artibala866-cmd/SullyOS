import React, { useState } from 'react';
import { ArrowLeft, ChatCircleDots, GearSix, Wallet, UsersThree, Images, House, MagnifyingGlass, Plus, Compass, User, ChatsCircle, SpinnerGap } from '@phosphor-icons/react';
import { safeResponseJson, extractContent } from '../../utils/safeApi';

type Tab = 'chats' | 'contacts' | 'discover' | 'me';
type Screen = 'home' | 'wechat' | 'thread' | 'moments' | 'wallet' | 'settings';
type ChatRecord = { id: string; name: string; preview: string; time: number; messages: { from: string; text: string }[] };
type Api = { baseUrl: string; apiKey: string; model: string };
const apps = [{ id: 'wechat' as const, label: '微信', Icon: ChatCircleDots }];
const timeLabel = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
export default function CharacterPhone({ name, characterId, persona, api, onClose }: { name: string; characterId: string; persona: string; api: Api; onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [tab, setTab] = useState<Tab>('chats');
  const [thread, setThread] = useState('');
  const [selectedNpc, setSelectedNpc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const storageKey = 'sully_character_phone_wechat_v1:' + characterId;
  const [records, setRecords] = useState<ChatRecord[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
  });
  const persist = (next: ChatRecord[]) => { setRecords(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setError('存储空间不足，记录未能保存'); } };
  const back = () => { if (screen === 'thread' || screen === 'moments' || screen === 'wallet' || screen === 'settings') setScreen('wechat'); else if (screen === 'wechat') setScreen('home'); else onClose(); };
  const generate = async (npcName = selectedNpc) => {
    if (busy) return;
    if (!api.apiKey || !api.baseUrl || !api.model) { setError('请先在 SullyOS 设置中配置聊天 API'); return; }
    setBusy(true); setError('');
    try {
      const target = npcName ? records.find(r => r.name === npcName) : undefined;
      const context = records.slice(0, 6).map(r => r.name + '：' + r.messages.slice(-8).map(m => m.from + '：' + m.text).join(' / ')).join('\n');
      const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
        body: JSON.stringify({ model: api.model, stream: false, temperature: 0.85, messages: [
          { role: 'system', content: `你正在模拟角色「${name}」的私人微信，角色设定：${persona.slice(0, 4500)}。请保持和私聊一致的自然、鲜活、口语化表达，有停顿、个性和真实关系边界，不要模板化、说教或夸张表演。角色和NPC都是虚构人物。${target ? `必须继续与现有联系人「${target.name}」聊天，不要换人或改名。之前的对话：${target.messages.slice(-16).map(m => m.from + '：' + m.text).join(' / ')}` : '根据角色背景创造一位合理的朋友、家人或同事，与角色进行一段生活化的微信对话。优先选择已有联系人，避免无意义地不断创建新朋友。'}对话不一定围绕用户。只输出合法JSON对象：{"name":"NPC名字","messages":[{"from":"NPC名字","text":"短消息"},{"from":"${name}","text":"短消息"}]}。共4到8条短消息，不要markdown。已有记录：${context}` },
          { role: 'user', content: '生成一段符合角色设定、像真实朋友微信聊天一样的日常对话。' }
        ] })
      });
      const json = await safeResponseJson(response);
      if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
      const raw = extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const data = JSON.parse(raw);
      if (typeof data.name !== 'string' || !Array.isArray(data.messages)) throw new Error('生成内容格式不正确');
      const messages = data.messages.slice(0, 12).filter((m: any) => typeof m?.from === 'string' && typeof m?.text === 'string').map((m: any) => ({ from: m.from.slice(0, 40), text: m.text.slice(0, 600) }));
      if (!messages.length) throw new Error('没有生成有效消息');
      const npc = target?.name || data.name.trim().slice(0, 40);
      if (!npc) throw new Error('NPC 名称为空');
      const existing = target || records.find(r => r.name === npc);
      const next: ChatRecord = { id: existing?.id || String(Date.now()), name: npc, preview: messages[messages.length - 1].text, time: Date.now(), messages: [...(existing?.messages || []), ...messages] };
      persist([next, ...records.filter(r => r.id !== existing?.id)]); setTab('chats'); setSelectedNpc('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const active = records.find(r => r.id === thread);
  const row = (label: string, icon: React.ReactNode, click: () => void) => <button type="button" onClick={click} className="flex w-full items-center gap-4 border-b border-[#e9e9e9] bg-white px-5 py-4 text-left text-[16px] text-[#222]"><span className="text-[#21ad68]">{icon}</span><span className="flex-1">{label}</span><span className="text-[#bbb]">›</span></button>;
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-2" role="dialog" aria-modal="true" aria-label={name + '的手机'}>
    <div className="flex h-[min(96dvh,850px)] w-full max-w-[430px] flex-col overflow-hidden rounded-[28px] border-[5px] border-[#252525] bg-[#ededed] shadow-2xl">
      <div className="flex shrink-0 items-center justify-between bg-[#ededed] px-5 pb-2 pt-3 text-[13px] text-[#222]"><span>{timeLabel(Date.now())}</span><span>▰ ▴ ▣</span></div>
      {screen === 'home' ? <header className="flex items-center gap-3 px-4 py-3"><button onClick={onClose} aria-label="关闭"><ArrowLeft size={23}/></button><strong className="flex-1 text-center">{name}的手机</strong><span className="w-6"/></header> :
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dcdcdc] bg-[#ededed] px-4 py-3">
          <button type="button" onClick={back} aria-label="返回"><ArrowLeft size={23}/></button>
          <h2 className="min-w-0 flex-1 truncate text-center text-[19px] font-medium text-[#181818]">{screen === 'wechat' ? ({ chats: '微信', contacts: '通讯录', discover: '发现', me: '我' }[tab]) : screen === 'thread' ? active?.name : ({ moments: '朋友圈', wallet: '钱包', settings: '设置' } as Record<string,string>)[screen]}</h2>
          {screen === 'wechat' && tab === 'chats' ? <div className="flex gap-4"><button type="button" aria-label="搜索聊天" onClick={() => setError('搜索功能后续接入')}><MagnifyingGlass size={23}/></button><button type="button" aria-label="AI生成角色聊天记录" disabled={busy} onClick={() => generate()}>{busy ? <SpinnerGap size={24} className="animate-spin"/> : <Plus size={25}/>}</button></div> : <span className="w-6"/>}
        </header>}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {error && <div role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-700">{error}<button className="ml-3 underline" onClick={() => setError('')}>关闭</button></div>}
        {screen === 'home' && <div className="grid grid-cols-4 gap-4 p-6">{apps.map(({id,label,Icon})=><button key={id} onClick={()=>{setScreen(id);setTab('chats');}} className="flex flex-col items-center gap-2 text-xs"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#18c45b] text-white"><Icon size={31} weight="fill"/></span>{label}</button>)}</div>}
        {screen === 'wechat' && tab === 'chats' && (records.length ? records.map(r=><button key={r.id} type="button" onClick={()=>{setThread(r.id);setScreen('thread');}} className="flex w-full items-center gap-3 border-b border-[#e5e5e5] bg-white px-4 py-3 text-left"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#b9d9c6] text-xl text-white">{r.name.slice(0,1)}</div><div className="min-w-0 flex-1"><div className="truncate text-[17px] text-[#222]">{r.name}</div><div className="truncate pt-1 text-[13px] text-[#999]">{r.preview}</div></div><span className="self-start text-xs text-[#aaa]">{timeLabel(r.time)}</span></button>) : <p className="p-8 text-center text-sm text-[#999]">暂无聊天记录，点击右上角＋生成</p>)}
        {screen === 'wechat' && tab === 'contacts' && <div>{row('新的朋友', <UsersThree size={23}/>, ()=>setError('联系人管理后续接入'))}{[...new Set(records.map(r=>r.name))].map(n=>row(n,<User size={22}/>,()=>{const r=records.find(x=>x.name===n);if(r){setThread(r.id);setScreen('thread');}}))}</div>}
        {screen === 'wechat' && tab === 'discover' && row('朋友圈',<Images size={23}/>,()=>setScreen('moments'))}
        {screen === 'wechat' && tab === 'me' && <div className="pt-4">{row(name,<User size={24}/>,()=>{})}<div className="mt-3">{row('钱包',<Wallet size={23}/>,()=>setScreen('wallet'))}{row('设置',<GearSix size={23}/>,()=>setScreen('settings'))}</div></div>}
        {screen === 'thread' && <div className="space-y-4 p-4">{active?.messages.map((m,i)=><div key={i} className={`flex gap-2 ${m.from === name ? 'flex-row-reverse' : ''}`}><div className={`max-w-[78%] rounded-lg px-3 py-2 text-[15px] leading-relaxed ${m.from === name ? 'bg-[#95ec69]' : 'bg-white'}`}><span className="mb-1 block text-[10px] text-[#777]">{m.from}</span>{m.text}</div></div>)}</div>}
        {screen === 'moments' && <p className="p-8 text-center text-sm text-[#888]">朋友圈动态后续接入真人模式事件</p>}
        {screen === 'wallet' && <p className="p-8 text-center text-sm text-[#888]">钱包与小红书集市交易后续接入</p>}
        {screen === 'settings' && <p className="p-8 text-center text-sm text-[#888]">NPC互动和API设置后续接入；当前生成使用私聊同一套聊天API</p>}
      </main>
      {screen === 'thread' && active && <div className="flex shrink-0 items-center justify-center border-t border-[#ddd] bg-[#f8f8f8] px-4 py-3"><button type="button" disabled={busy} onClick={() => generate(active.name)} className="rounded-lg bg-[#07b75b] px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? '正在生成…' : 'AI 续聊'}</button></div>}
      {screen === 'wechat' && <nav className="grid shrink-0 grid-cols-4 border-t border-[#ddd] bg-[#f8f8f8] py-2">{([{id:'chats',label:'微信',Icon:ChatCircleDots},{id:'contacts',label:'通讯录',Icon:UsersThree},{id:'discover',label:'发现',Icon:Compass},{id:'me',label:'我',Icon:User}] as const).map(({id,label,Icon})=><button key={id} onClick={()=>setTab(id)} className={`flex flex-col items-center gap-1 text-xs ${tab===id?'text-[#07b75b]':'text-[#222]'}`}><Icon size={26} weight={tab===id?'fill':'regular'}/>{label}</button>)}</nav>}
      {screen !== 'wechat' && <footer className="flex shrink-0 justify-center border-t border-[#ddd] bg-[#fafafa] py-2"><button type="button" onClick={()=>setScreen('home')} aria-label="返回手机桌面"><House size={21}/></button></footer>}
    </div>
  </div>;
}
