import React, { useState, useEffect } from 'react';
import { ArrowLeft, ChatCircleDots, GearSix, Wallet, UsersThree, Images, House, MagnifyingGlass, Plus, Compass, User, ChatsCircle, SpinnerGap } from '@phosphor-icons/react';
import { parseGeneratedPhoneMessages, type PhoneMessage } from '../../utils/characterPhoneIdentity';
import { safeResponseJson, extractContent } from '../../utils/safeApi';
import { CHARACTER_LIFE_EVENTS_CHANGED, readCharacterLifeEvents, recordCharacterLifeEvent, type CharacterLifeEvent } from '../../utils/characterLifeEvents';
import { CHARACTER_PHONE_CONTACT_CHANGED, readNpcProfiles, saveNpcProfiles, type NpcProfile } from '../../utils/characterPhoneNpcs';

type Tab = 'chats' | 'contacts' | 'discover' | 'me';
type Screen = 'home' | 'wechat' | 'thread' | 'contact-detail' | 'moments' | 'wallet' | 'settings';
type ChatRecord = { id: string; contactId?: string; name: string; preview: string; time: number; messages: PhoneMessage[] };
type Api = { baseUrl: string; apiKey: string; model: string };
const apps = [{ id: 'wechat' as const, label: '微信', Icon: ChatCircleDots }];
const timeLabel = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
export default function CharacterPhone({ name, characterId, persona, api, onClose }: { name: string; characterId: string; persona: string; api: Api; onClose: () => void }) {
  const [screen, setScreen] = useState<Screen>('home');
  const [tab, setTab] = useState<Tab>('chats');
  const [thread, setThread] = useState('');
  const [contactId, setContactId] = useState('');
  const [editing, setEditing] = useState(false);
  const [refreshingContacts, setRefreshingContacts] = useState(false);
  const [draft, setDraft] = useState({ name:'', identity:'', personality:'', relationship:'', background:'' });
  const [profiles, setProfiles] = useState<NpcProfile[]>(() => readNpcProfiles(characterId));
  const [lifeEvents, setLifeEvents] = useState<CharacterLifeEvent[]>(() => readCharacterLifeEvents(characterId));
  useEffect(() => {
    setLifeEvents(readCharacterLifeEvents(characterId));
    const sync = (event: Event) => { if ((event as CustomEvent<{characterId:string}>).detail?.characterId === characterId) setLifeEvents(readCharacterLifeEvents(characterId)); };
    window.addEventListener(CHARACTER_LIFE_EVENTS_CHANGED, sync);
    return () => window.removeEventListener(CHARACTER_LIFE_EVENTS_CHANGED, sync);
  }, [characterId]);
  useEffect(() => {
    setProfiles(readNpcProfiles(characterId));
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ characterId: string }>).detail;
      if (detail?.characterId === characterId) setProfiles(readNpcProfiles(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_CONTACT_CHANGED, sync);
    return () => window.removeEventListener(CHARACTER_PHONE_CONTACT_CHANGED, sync);
  }, [characterId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const storageKey = 'sully_character_phone_wechat_v1:' + characterId;
  const [records, setRecords] = useState<ChatRecord[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
  });
  const persistProfiles = (next: NpcProfile[]) => { try { saveNpcProfiles(characterId, next); setProfiles(next); } catch { setError('联系人档案保存失败'); } };
  const persist = (next: ChatRecord[]) => { setRecords(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setError('存储空间不足，记录未能保存'); } };
  const back = () => { if (screen === 'contact-detail') { setScreen('wechat'); setTab('contacts'); setEditing(false); return; } if (screen === 'thread' || screen === 'moments' || screen === 'wallet' || screen === 'settings') setScreen('wechat'); else if (screen === 'wechat') setScreen('home'); else onClose(); };
  const createProfile = async () => {
    if (busy) return;
    if (!api.apiKey || !api.baseUrl || !api.model) { setError('请先配置聊天 API'); return; }
    setBusy(true); setRefreshingContacts(true); setError('');
    try {
      const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
        body: JSON.stringify({ model: api.model, stream: false, messages: [
          { role: 'system', content: `你是严格的角色设定档案管理员，不是随机NPC生成器。手机主人Char的唯一ID是${characterId}，显示名${name}。角色人设：${persona.slice(0, 9500)}。只能从人设明确提到或可明确推导的真实社会关系中选择联系人；没有足够依据则返回JSON {\"error\":\"人设中缺少可确认的联系人，请补充人物关系\"}，禁止凭空杜撰朋友、家人、同事及亲密关系。已有联系人：${profiles.map(p => p.name+'('+p.relationship+')').join('、')}。User与Char与NPC身份不同；同名或水仙不能视为同一人。仅返回JSON对象，字段name,identity,personality,relationship,background均为非空字符串。` },
          { role: 'user', content: '根据人设中已有的人物关系建立一份联系人档案；无法确认则返回error，不要编造。不要生成聊天消息。' }
        ] })
      });
      const json = await safeResponseJson(response);
      if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
      const data = JSON.parse(extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (typeof data?.error === 'string') throw new Error(data.error);
      if (!data || !['name','identity','personality','relationship','background'].every(k => typeof data[k] === 'string' && data[k].trim())) throw new Error('档案格式不正确');
      const npcName = data.name.trim().slice(0, 40);
      // A matching display name is not proof of matching identity.
      const profile: NpcProfile = { id: crypto.randomUUID(), name: npcName, identity: data.identity.slice(0, 240), personality: data.personality.slice(0, 700), relationship: data.relationship.slice(0, 400), background: data.background.slice(0, 900), source: 'generated', createdAt: Date.now() };
      persistProfiles([...profiles, profile]);
      recordCharacterLifeEvent({ id: 'contact:' + profile.id, characterId, kind: 'contact-added', occurredAt: profile.createdAt, source: 'phone', summary: '新增联系人：' + profile.name, contactId: profile.id });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setRefreshingContacts(false); }
  };
  const generate = async (npcName = '') => {
    if (busy) return;
    if (!api.apiKey || !api.baseUrl || !api.model) { setError('请先在 SullyOS 设置中配置聊天 API'); return; }
    const profile = profiles.find(p => p.id === npcName) || (!npcName && profiles.length === 1 ? profiles[0] : undefined);
    if (!profile) { setError('请先到通讯录生成 NPC 档案'); setTab('contacts'); return; }
    npcName = profile.name;
    setBusy(true); setError('');
    try {
      const target = records.find(r => r.contactId === profile.id);
      const context = records.slice(0, 6).map(r => r.name + '：' + r.messages.slice(-8).map(m => (m.speaker?.role === 'owner' ? '[手机主人]' : m.speaker?.role === 'contact' ? '[联系人]' : '[旧消息身份未验证]') + '：' + m.text).join(' / ')).join('\n');
      const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
        body: JSON.stringify({ model: api.model, stream: false, temperature: 0.85, messages: [
          { role: 'system', content: `你正在模拟角色「${name}」的私人微信，角色设定：${persona.slice(0, 9500)}。手机主人Char的ID是${characterId}。固定NPC档案：姓名${profile.name}，身份${profile.identity}，性格${profile.personality}，与角色关系${profile.relationship}，背景${profile.background}。必须严格遵守该档案，不得更名、改身份或改关系。请保持和私聊一致的自然、鲜活、口语化表达，有停顿、个性和真实关系边界，不要模板化、说教或夸张表演。角色和NPC都是虚构人物。${target ? `必须继续与现有联系人「${target.name}」聊天，不要换人或改名。之前的对话：${target.messages.slice(-16).map(m => (m.speaker?.role === 'owner' ? '[手机主人]' : m.speaker?.role === 'contact' ? '[联系人]' : '[旧消息身份未验证]') + '：' + m.text).join(' / ')}` : '根据角色背景创造一位合理的朋友、家人或同事，与角色进行一段生活化的微信对话。优先选择已有联系人，避免无意义地不断创建新朋友。'}对话不一定围绕用户。只输出合法JSON对象：{"name":"${profile.name}","messages":[{"speaker":"contact","text":"短消息"},{"speaker":"owner","text":"短消息"}]}。speaker只能为owner或contact，owner是手机主人Char，contact是当前联系人；即使双方同名或是水仙，也绝对不能根据名字推断发言者。User不是NPC，不能混入。必须生成8到14条独立的微信消息，双方都要有发言，每条一条气泡，禁止把整段对话塞入单条text。至少8条，否则视为失败。不要markdown。已有记录：${context}` },
          { role: 'user', content: '生成一段符合角色设定、像真实朋友微信聊天一样的日常对话。' }
        ] })
      });
      const json = await safeResponseJson(response);
      if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
      const raw = extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const data = JSON.parse(raw);
      if (typeof data.name !== 'string' || !Array.isArray(data.messages)) throw new Error('生成内容格式不正确');
      const messages = parseGeneratedPhoneMessages(data.messages, profile.id);
      if (messages.length < 8 || !messages.some(m => m.speaker.role === 'owner') || !messages.some(m => m.speaker.role === 'contact')) throw new Error('生成不足8条有效消息或缺少一方发言，请重试（本次未保存）');
      const npc = profile.name;
      if (!npc) throw new Error('NPC 名称为空');
      const existing = target;
      const next: ChatRecord = { id: existing?.id || crypto.randomUUID(), contactId: profile.id, name: npc, preview: messages[messages.length - 1].text, time: Date.now(), messages: [...(existing?.messages || []), ...messages] };
      persist([next, ...records.filter(r => r.id !== existing?.id)]); setTab('chats');
      recordCharacterLifeEvent({ id: 'npc-chat:' + next.id + ':' + next.time, characterId, kind: 'npc-chat', occurredAt: next.time, source: 'phone', summary: name + ' 与 ' + npc + ' 进行了微信聊天', contactId: profile.id });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const active = records.find(r => r.id === thread);
  const contact = profiles.find(p => p.id === contactId);
  const openContact = (p: NpcProfile) => { setContactId(p.id); setDraft({name:p.name,identity:p.identity,personality:p.personality,relationship:p.relationship,background:p.background}); setEditing(false); setScreen('contact-detail'); };
  const saveContact = () => {
    if (!contact || !draft.name.trim() || !draft.identity.trim() || !draft.relationship.trim() || !draft.personality.trim()) { setError('姓名、身份、关系和性格不能为空'); return; }
    const newName = draft.name.trim();
    // Duplicate display names are allowed; stable contact IDs keep them separate.
    persistProfiles(profiles.map(p=>p.id===contact.id ? {...p,...draft,name:newName} : p));
    if (contact.name!==newName) persist(records.map(r=>r.contactId===contact.id ? {...r,name:newName} : r));
    setEditing(false);
  };
  const row = (label: string, icon: React.ReactNode, click: () => void) => <button type="button" onClick={click} className="flex w-full items-center gap-4 border-b border-[#e9e9e9] bg-white px-5 py-4 text-left text-[16px] text-[#222]"><span className="text-[#21ad68]">{icon}</span><span className="flex-1">{label}</span><span className="text-[#bbb]">›</span></button>;
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-2" role="dialog" aria-modal="true" aria-label={name + '的手机'}>
    <div className="flex h-[min(96dvh,850px)] w-full max-w-[430px] flex-col overflow-hidden rounded-[28px] border-[5px] border-[#252525] bg-[#ededed] shadow-2xl">
      <div className="flex shrink-0 items-center justify-between bg-[#ededed] px-5 pb-2 pt-3 text-[13px] text-[#222]"><span>{timeLabel(Date.now())}</span><span>▰ ▴ ▣</span></div>
      {screen === 'home' ? <header className="flex items-center gap-3 px-4 py-3"><button onClick={onClose} aria-label="关闭"><ArrowLeft size={23}/></button><strong className="flex-1 text-center">{name}的手机</strong><span className="w-6"/></header> :
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dcdcdc] bg-[#ededed] px-4 py-3">
          <button type="button" onClick={back} aria-label="返回"><ArrowLeft size={23}/></button>
          <h2 className="min-w-0 flex-1 truncate text-center text-[19px] font-medium text-[#181818]">{screen === 'wechat' ? ({ chats: '微信', contacts: '通讯录', discover: '发现', me: '我' }[tab]) : screen === 'thread' ? active?.name : screen === 'contact-detail' ? contact?.name : ({ moments: '朋友圈', wallet: '钱包', settings: '设置' } as Record<string,string>)[screen]}</h2>
          {screen === 'wechat' && tab === 'chats' ? <div className="flex gap-4"><button type="button" aria-label="搜索聊天" onClick={() => setError('搜索功能后续接入')}><MagnifyingGlass size={23}/></button><button type="button" aria-label="AI生成角色聊天记录" disabled={busy} onClick={() => { if (profiles.length === 1) generate(profiles[0].id); else { setTab('contacts'); setError('请选择联系人，点击「生成聊天」'); } }}>{busy ? <SpinnerGap size={24} className="animate-spin"/> : <Plus size={25}/>}</button></div> : <span className="w-6"/>}
        </header>}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {error && <div role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-700">{error}<button className="ml-3 underline" onClick={() => setError('')}>关闭</button></div>}
        {screen === 'home' && <div className="grid grid-cols-4 gap-4 p-6">{apps.map(({id,label,Icon})=><button key={id} onClick={()=>{setScreen(id);setTab('chats');}} className="flex flex-col items-center gap-2 text-xs"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#18c45b] text-white"><Icon size={31} weight="fill"/></span>{label}</button>)}</div>}
        {screen === 'wechat' && tab === 'chats' && (records.length ? records.map(r=><button key={r.id} type="button" onClick={()=>{setThread(r.id);setScreen('thread');}} className="flex w-full items-center gap-3 border-b border-[#e5e5e5] bg-white px-4 py-3 text-left"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#b9d9c6] text-xl text-white">{r.name.slice(0,1)}</div><div className="min-w-0 flex-1"><div className="truncate text-[17px] text-[#222]">{r.name}</div><div className="truncate pt-1 text-[13px] text-[#999]">{r.preview}</div></div><span className="self-start text-xs text-[#aaa]">{timeLabel(r.time)}</span></button>) : <p className="p-8 text-center text-sm text-[#999]">暂无聊天记录，请先在通讯录生成 NPC 档案</p>)}
        {screen === 'wechat' && tab === 'contacts' && <div className="bg-white">
          <button type="button" disabled={busy} onClick={createProfile} className="flex w-full items-center gap-3 border-b border-[#eee] px-5 py-3 text-left disabled:opacity-50"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-400 text-white"><Plus size={24}/></span>{refreshingContacts?'正在根据人设查找联系人…':'刷新生成联系人'}</button>
          <div className="bg-[#ededed] px-5 py-2 text-xs text-[#888]">联系人 · {profiles.length}　点击上方按钮手动生成，不自动乱加</div>
          {[...profiles].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(p=><button type="button" key={p.id} onClick={()=>openContact(p)} className="flex w-full items-center gap-3 border-b border-[#eee] px-5 py-3 text-left"><span className="flex h-11 w-11 items-center justify-center rounded-md bg-[#a9cbb5] text-lg text-white">{p.name.slice(0,1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-base">{p.name}</span><span className="block truncate text-xs text-[#999]">{p.relationship}</span></span><span className="text-[#bbb]">›</span></button>)}
        </div>}
        {screen === 'contact-detail' && contact && <div className="space-y-3 pb-6">
          <div className="flex items-center gap-4 bg-white px-5 py-6"><span className="flex h-16 w-16 items-center justify-center rounded-lg bg-[#a9cbb5] text-2xl text-white">{contact.name.slice(0,1)}</span><div><h3 className="text-xl font-semibold">{contact.name}</h3><p className="text-sm text-[#888]">{contact.identity}</p></div></div>
          <div className="bg-white">{([{key:'name',label:'姓名'},{key:'identity',label:'身份'},{key:'relationship',label:'关系'},{key:'personality',label:'性格'},{key:'background',label:'背景'}] as const).map(({key,label})=><div key={key} className="flex gap-3 border-b border-[#eee] px-5 py-4 text-sm"><span className="w-14 shrink-0 text-[#888]">{label}</span>{editing?<textarea rows={key==='background'||key==='personality'?3:1} value={draft[key]} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))} className="min-w-0 flex-1 resize-none bg-transparent outline-none"/>:<span className="whitespace-pre-wrap">{contact[key]}</span>}</div>)}</div>
          <div className="space-y-3 px-5">{editing?<><button type="button" onClick={saveContact} className="w-full rounded-lg bg-[#07b75b] py-3 text-white">保存档案</button><button type="button" onClick={()=>setEditing(false)} className="w-full rounded-lg bg-white py-3">取消</button></>:<><button type="button" onClick={()=>setEditing(true)} className="w-full rounded-lg bg-white py-3">编辑联系人资料</button><button type="button" disabled={busy} onClick={()=>{setScreen('wechat');setTab('contacts');void generate(contact.id);}} className="w-full rounded-lg bg-[#07b75b] py-3 text-white disabled:opacity-50">AI生成聊天</button></>}</div>
        </div>}
        {screen === 'wechat' && tab === 'discover' && row('朋友圈',<Images size={23}/>,()=>setScreen('moments'))}
        {screen === 'wechat' && tab === 'me' && <div className="pt-4">{row(name,<User size={24}/>,()=>{})}<div className="mt-3">{row('钱包',<Wallet size={23}/>,()=>setScreen('wallet'))}{row('设置',<GearSix size={23}/>,()=>setScreen('settings'))}</div></div>}
        {screen === 'thread' && <div className="space-y-4 p-4">{active?.messages.map((m,i)=><div key={i} className={`flex gap-2 ${m.speaker?.role === 'owner' ? 'flex-row-reverse' : ''}`}><div className={`max-w-[78%] rounded-lg px-3 py-2 text-[15px] leading-relaxed ${m.speaker?.role === 'owner' ? 'bg-[#95ec69]' : 'bg-white'}`}><span className="mb-1 block text-[10px] text-[#777]">{m.speaker?.role === 'owner' ? name : m.speaker?.role === 'contact' ? active?.name : '旧消息'}</span>{m.text}</div></div>)}</div>}
        {screen === 'moments' && <div className="space-y-3 p-4">{lifeEvents.filter(e=>e.kind==='moment-post'||e.kind==='moment-comment').length ? lifeEvents.filter(e=>e.kind==='moment-post'||e.kind==='moment-comment').map(e=><div key={e.id} className="rounded-lg bg-white p-4"><p className="text-sm text-[#333]">{e.summary}</p><time className="mt-2 block text-xs text-[#999]">{new Date(e.occurredAt).toLocaleString('zh-CN')}</time></div>) : <p className="p-8 text-center text-sm text-[#888]">暂无朋友圈动态，等待真人模式产生真实事件</p>}</div>}
        {screen === 'wallet' && <p className="p-8 text-center text-sm text-[#888]">钱包与小红书集市交易后续接入</p>}
        {screen === 'settings' && <p className="p-8 text-center text-sm text-[#888]">NPC互动和API设置后续接入；当前生成使用私聊同一套聊天API</p>}
      </main>
      {screen === 'thread' && active && <div className="flex shrink-0 items-center justify-center border-t border-[#ddd] bg-[#f8f8f8] px-4 py-3"><button type="button" disabled={busy} onClick={() => generate(active.contactId || active.name)} className="rounded-lg bg-[#07b75b] px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? '正在生成…' : 'AI 续聊'}</button></div>}
      {screen === 'wechat' && <nav className="grid shrink-0 grid-cols-4 border-t border-[#ddd] bg-[#f8f8f8] py-2">{([{id:'chats',label:'微信',Icon:ChatCircleDots},{id:'contacts',label:'通讯录',Icon:UsersThree},{id:'discover',label:'发现',Icon:Compass},{id:'me',label:'我',Icon:User}] as const).map(({id,label,Icon})=><button key={id} onClick={()=>setTab(id)} className={`flex flex-col items-center gap-1 text-xs ${tab===id?'text-[#07b75b]':'text-[#222]'}`}><Icon size={26} weight={tab===id?'fill':'regular'}/>{label}</button>)}</nav>}
      {screen !== 'wechat' && <footer className="flex shrink-0 justify-center border-t border-[#ddd] bg-[#fafafa] py-2"><button type="button" onClick={()=>setScreen('home')} aria-label="返回手机桌面"><House size={21}/></button></footer>}
    </div>
  </div>;
}
