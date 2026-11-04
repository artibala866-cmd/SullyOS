import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpenText, CalendarHeart, CaretLeft, CaretRight, ArrowRight, EnvelopeSimple, GearSix, Gift, HandHeart, Heart, Hourglass, Leaf, ListChecks, Medal, ShoppingBag, Tree, Users } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { avatarTouchPartLabel, resolveAvatarTouchTarget } from '../utils/avatarTouch';
import { listCompanionDateOutfits, resolveCompanionPortrait } from '../utils/companionAvatar';
import { useLocalBackHandler } from '../hooks/useLocalBackHandler';
import TokenImg from '../components/os/TokenImg';
import { AppID, type APIConfig, type CharacterProfile, type GalleryImage } from '../types';
import { DB } from '../utils/db';
import { characterBlocksUser, userBlocksCharacter } from '../utils/chatBlock';
import { extractJson } from '../utils/safeApi';
import { processImage } from '../utils/file';
import { capsuleStatus, createBond, createEntry, dayKey, daysTogether, readSpaces, relationNames, reward, spaceKey, writeBond, careForPlant, plantStage, bondXp, bondLevel, panelLevels, type Bond, type EntryKind, type Relation } from '../utils/couplesSpace';
import { BondRecords, recordNames, type ChangeBond } from './couplesSpace/records';
import { BondShop, bondAchievements } from './couplesSpace/shop';
import { generateBondText, generateBondArtwork, generateBondPortrait, readPairDigest } from '../utils/couplesGeneration';
import './couplesSpace/couplesSpace.css';

type Panel = EntryKind | 'settings' | 'shop' | 'achievements' | 'plant' | 'touch';
const icons = { timeline: Heart, anniversary: CalendarHeart, diary: BookOpenText, wish: ListChecks, gift: Gift, mail: EnvelopeSimple, capsule: Hourglass, hollow: Tree, settings: GearSix, shop: ShoppingBag, achievements: Medal, plant: Leaf, touch: HandHeart };
const labels = { ...recordNames, settings: '空间设置', shop: '羁绊商店', achievements: '成就墙', plant: '同频阳台', touch: '专属贴贴' };
const mainPanels: Panel[] = ['timeline', 'anniversary', 'diary', 'wish', 'gift', 'touch', 'plant', 'mail', 'capsule', 'shop', 'achievements', 'hollow'];
const pairPanels: Panel[] = ['timeline', 'anniversary', 'diary', 'mail', 'wish', 'gift', 'plant'];
const relationCopy = {
  love: { name: '恋人之间', days: '在一起的第', sub: '收藏只属于两个人的日常' },
  family: { name: '家人的角落', days: '成为家人的第', sub: '把一屋子的牵挂慢慢收好' },
  friend: { name: '朋友基地', days: '并肩走过的第', sub: '记录默契、约定和一起闯过的日子' },
};

function Avatar({ person }: { person: { avatar: string; name: string } }) {
  const [failedAvatar, setFailedAvatar] = useState<string>();
  return <span className="couple-avatar">
    {person.avatar && failedAvatar !== person.avatar
      ? <TokenImg value={person.avatar} alt={person.name} onError={() => setFailedAvatar(person.avatar)} />
      : <span role="img" aria-label={person.name}>{Array.from(person.name.trim())[0] || '♡'}</span>}
  </span>;
}


/** Browsing this orbit never writes a bond or sends an invitation. */
function OrbitCharacterPicker({ characters, selectedId, status, busy, onSelect, onContinue, onPairs }: {
  characters: CharacterProfile[];
  selectedId: string;
  status?: Bond['status'];
  busy: boolean;
  onSelect: (id: string) => void;
  onContinue: () => void;
  onPairs: () => void;
}) {
  const activeIndex = Math.max(0, characters.findIndex(item => item.id === selectedId));
  const active = characters[activeIndex];
  const touchStart = useRef<number>();
  const shift = (step: number) => {
    if (characters.length > 1) onSelect(characters[(activeIndex + step + characters.length) % characters.length].id);
  };
  return <section className="couple-picker" aria-label="环绕星球角色选择">
    <div className="couple-picker-intro">
      <span className="couple-picker-overline"><Heart size={13} weight="fill" /> OUR LITTLE UNIVERSE</span>
      <h2>情侣空间</h2><p>在星轨之间，找到想要连接的 TA</p>
    </div>
    {active ? <>
      <div className="couple-orbit-scene" aria-label="滑动星轨或点击头像切换角色"
        onTouchStart={event => { touchStart.current = event.touches[0]?.clientX; }}
        onTouchEnd={event => {
          if (touchStart.current === undefined) return;
          const distance = event.changedTouches[0]?.clientX - touchStart.current;
          touchStart.current = undefined;
          if (Math.abs(distance ?? 0) > 38) {
            event.preventDefault();
            shift(distance! < 0 ? 1 : -1);
          }
        }}>
        <div className="couple-orbit-aura" aria-hidden="true" />
        <div className="couple-orbit-track couple-orbit-track-back" aria-hidden="true" />
        <div className="couple-orbit-track couple-orbit-track-front" aria-hidden="true" />
        <div className="couple-orbit-core" key={active.id} aria-label={'当前角色：' + active.name}>
          <Avatar person={active} />
          <span className="couple-orbit-core-halo" aria-hidden="true" />
        </div>
        {characters.map((person, index) => {
          if (index === activeIndex) return null;
          const angle = Math.PI * 2 * (index - activeIndex) / characters.length;
          const depth = (Math.cos(angle) + 1) / 2;
          return <button type="button" className="couple-orbit-satellite" key={person.id}
            aria-label={'选择角色：' + person.name} disabled={busy}
            onClick={() => onSelect(person.id)}
            style={{
              left: (50 + Math.sin(angle) * 41) + '%',
              top: (51 + Math.cos(angle) * 21) + '%',
              transform: 'translate(-50%, -50%) translateZ(' + Math.round(depth * 30) + 'px) scale(' + (0.81 + depth * 0.17) + ')',
              zIndex: Math.round(depth * 8) + 2,
            }}>
            <Avatar person={person} />
          </button>;
        })}
        <span className="couple-orbit-spark couple-orbit-spark-left" aria-hidden="true" />
        <span className="couple-orbit-spark couple-orbit-spark-right" aria-hidden="true" />
      </div>
      <div className="couple-picker-navigation">
        <button type="button" aria-label="上一个角色" disabled={busy || characters.length < 2} onClick={() => shift(-1)}><CaretLeft size={19} /></button>
        <span>角色 {activeIndex + 1} / {characters.length}</span>
        <button type="button" aria-label="下一个角色" disabled={busy || characters.length < 2} onClick={() => shift(1)}><CaretRight size={19} /></button>
      </div>
      <div className="couple-picker-profile">
        <Avatar person={active} />
        <div className="couple-picker-profile-copy">
          <strong>{active.name}</strong>
          <small>{status === 'open' ? '专属空间已建立' : status === 'pending' ? '有一份等待回应的邀请' : status === 'declined' ? '可重新发出邀请' : '等待与你建立专属连接'}</small>
        </div>
        <span className="couple-picker-state">{status === 'open' ? '已绑定' : status === 'pending' ? '待回应' : '待绑定'}</span>
      </div>
      <button type="button" className="couple-picker-confirm" disabled={busy} onClick={onContinue}>
        {status === 'open' ? '进入专属空间' : status === 'pending' ? '查看邀请' : '选择此角色'} <ArrowRight size={18} />
      </button>
      <button type="button" className="couple-picker-pairs" disabled={busy} onClick={onPairs}><Users size={18} /> 他们的空间</button>
      <p className="couple-picker-hint">轻点环绕头像切换 · 确认后再选择关系与邀请</p>
    </> : <div className="couple-picker-empty">
      <Heart size={32} weight="thin" /><p>还没有可以绑定的角色</p>
      <small>先创建角色，再回来开启你们的空间。</small>
    </div>}
  </section>;
}

export default function CouplesSpaceApp() {
  const { closeApp, openApp, characters, activeCharacterId, setActiveCharacterId, userProfile, apiConfig, addToast } = useOS();
  const [partnerId, setPartnerId] = useState(() => characters.some(item => item.id === activeCharacterId) ? activeCharacterId : characters[0]?.id || '');
  const [pickerStep, setPickerStep] = useState<'orbit' | 'actions' | 'space'>('orbit');
  const [pairs, setPairs] = useState(false);
  const [pair, setPair] = useState<string[]>([]);
  const [pairA, setPairA] = useState('');
  const [pairB, setPairB] = useState('');
  const [panel, setPanel] = useState<Panel>();
  const [lockedPanel, setLockedPanel] = useState<Panel>();
  const [spaces, setSpaces] = useState<Awaited<ReturnType<typeof readSpaces>>>();
  const [relation, setRelation] = useState<Relation>('love');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [digest, setDigest] = useState<string>();
  const [gallery, setGallery] = useState<GalleryImage[]>();
  const requestRef = useRef<AbortController>();
  const loading = useRef(false);
  const scroll = useRef<HTMLElement>(null);
  const isPair = pairs && pair.length === 2;
  const members = pairs ? pair : [partnerId];
  const key = spaceKey(members);
  const bond = spaces?.[key];
  const char = characters.find(item => item.id === (isPair ? pair[0] : partnerId));
  const other = isPair ? characters.find(item => item.id === pair[1]) : undefined;
  const names = isPair ? { me: char?.name ?? '角色 A', them: other?.name ?? '角色 B' } :
    { me: userProfile.name || '我', them: char?.name ?? 'TA' };
  const selectedRelation = bond?.relation ?? relation;
  const days = bond ? daysTogether(bond.start) : 0;
  const today = useLocalDateKey();
  const readyCapsules = bond?.entries.filter(item => item.kind === 'capsule' && capsuleStatus(item, today) === 'ready').length ?? 0;

  useEffect(() => {
    let active = true;
    const load = () => void readSpaces().then(value => { if (active) setSpaces(value); }, () => {
      if (active) setError('情侣空间读取失败，请重新打开');
    });
    load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); requestRef.current?.abort(); };
  }, []);
  useEffect(() => { setError(''); setDigest(undefined); }, [key]);
  useEffect(() => {
    if (characters.length && !characters.some(item => item.id === partnerId)) {
      setPartnerId(characters[0].id);
      setPickerStep('orbit');
    }
  }, [characters, partnerId]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [panel, key, pairs, pickerStep]);
  const back = () => {
    if (busy) return true;
    if (lockedPanel) { setLockedPanel(undefined); return true; }
    if (panel) { setPanel(undefined); return true; }
    if (isPair) { setPair([]); return true; }
    if (pairs) { setPairs(false); setPickerStep('orbit'); return true; }
    if (pickerStep !== 'orbit') { setPickerStep('orbit'); return true; }
    return false;
  };
  useLocalBackHandler(back, 25);

  const persist = async (ids: string[], update: (current: Bond | undefined) => Bond | undefined) => {
    const entry = await writeBond(ids, update);
    setSpaces(current => {
      const next = { ...current };
      if (entry) next[spaceKey(ids)] = entry;
      else delete next[spaceKey(ids)];
      return next;
    });
    return entry;
  };
  const change: ChangeBond = async update => {
    if (!bond) throw new Error('请先建立空间');
    await persist(members, current => {
      if (current?.id !== bond.id) throw new Error('空间已经重置，请重新进入');
      return update(current);
    });
  };
  const run = async (task: () => Promise<void>) => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { loading.current = false; setBusy(false); }
  };
  const generate = async (instruction: string, current = bond) => {
    if (!char || !current || (isPair && !other)) throw new Error('请先选择角色');
    if (!isPair && (characterBlocksUser(char.chatBlock) || userBlocksCharacter(char.chatBlock))) throw new Error('当前私聊已拉黑，无法请求角色回应');
    if (requestRef.current) throw new Error('角色正在回应');
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 90_000);
    try {
      return await generateBondText(char, other ? { name: other.name, avatar: other.avatar, bio: '' } : userProfile,
        apiConfig, current, instruction, controller.signal, other);
    } finally { clearTimeout(timer); requestRef.current = undefined; }
  };
  const openChat = () => {
    if (!char || isPair) return;
    setActiveCharacterId(char.id);
    openApp(AppID.Chat);
  };
  const share = async (content: string, label = '时光信箱') => {
    if (isPair || !char) throw new Error('他们的空间属于这两位角色');
    const latest = await DB.getCharacter(char.id);
    if (!latest || characterBlocksUser(latest.chatBlock)) throw new Error('当前无法发给这个角色');
    await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content, metadata: { couplesSpace: { label } } });
    openChat();
  };
  const bind = (direct: boolean) => void run(async () => {
    if (!char || !spaces) return;
    if (!direct && (characterBlocksUser(char.chatBlock) || userBlocksCharacter(char.chatBlock))) throw new Error('当前私聊已拉黑，无法发送绑定申请');
    if (direct && !window.confirm(`以「${relationNames[selectedRelation]}」关系建立和 ${char.name} 的空间？`)) return;
    const pending = await persist(members, current => {
      if (current?.status === 'open') return current;
      const next = current?.status === 'pending' ? current : { ...createBond(members, selectedRelation), ...current, id: crypto.randomUUID() };
      return { ...next, status: direct ? 'open' : 'pending', start: dayKey() };
    });
    if (!pending) return;
    if (direct || pending.status === 'open') { setPickerStep('space'); return; }
    await DB.saveMessageOnce(`couples-invite:${pending.id}`, {
      charId: char.id, role: 'user', type: 'text',
      content: `【情侣空间邀请】我想和你建立一个${relationNames[pending.relation]}空间，你愿意吗？`, metadata: { couplesSpace: { label: '绑定邀请' } },
    });
    const response = extractJson(await generate(`用户邀请你建立${relationNames[pending.relation]}空间。依据真实关系和角色性格独立选择接受或拒绝。仅输出 JSON {"accept":true或false,"reply":"角色给用户的自然答复"}。`, pending));
    if (typeof response?.accept !== 'boolean' || typeof response?.reply !== 'string' || !response.reply.trim()) throw new Error('没有读到明确答复，可以继续等待或重试');
    const latest = await DB.getCharacter(char.id);
    if (!latest || characterBlocksUser(latest.chatBlock) || userBlocksCharacter(latest.chatBlock)) throw new Error('当前私聊无法接收绑定答复');
    const updated = await persist(members, current => current?.id === pending.id && current.status === 'pending'
      ? { ...current, status: response.accept ? 'open' : 'declined' } : current);
    if (updated?.id !== pending.id || updated.status !== (response.accept ? 'open' : 'declined')) return;
    await DB.saveMessageOnce(`couples-invite-reply:${pending.id}`, {
      charId: char.id, role: 'assistant', type: 'text',
      content: `【${response.accept ? '接受邀请' : '婉拒邀请'}】${response.reply.trim()}`, metadata: { couplesSpace: { label: '邀请答复' } },
    });
    if (response.accept) setPickerStep('space');
    openChat();
  });
  const upload = (file: File | undefined, field: 'cover' | 'portrait') => {
    if (file) void run(async () => {
      if (file.size > 12 * 1024 * 1024) throw new Error('请选择 12 MB 以内的图片');
      const image = await processImage(file, { maxWidth: 1000 });
      await change(current => ({ ...current, [field]: image, ...(field === 'cover' ? { position: 50, zoom: 1 } : {}) }));
    });
  };
  const createPair = () => void run(async () => {
    if (!pairA || !pairB || pairA === pairB) return;
    const ids = [pairA, pairB];
    await persist(ids, current => current ?? createBond(ids, relation));
    setPair(ids);
  });
  const pairList = Object.values(spaces ?? {}).filter(item => item.members.length === 2);
  const headerTitle = panel ? labels[panel] : pairs ? '他们的空间' : '情侣空间';

  return <div className={'couple-app' + (!pairs && !panel && pickerStep === 'orbit' ? ' couple-picker-mode' : '')}>
    <header className="couple-header">
      <button aria-label="返回" onClick={() => { if (!back()) closeApp(); }}><ArrowLeft size={20} /></button>
      <h1>{headerTitle}</h1>
      {bond?.status === 'open' && !panel ? <button aria-label="空间设置" onClick={() => setPanel('settings')}><GearSix size={21} /></button> : <span />}
    </header>
    <main className="couple-main" ref={scroll}>
      {error && <p role="alert" className="couple-error">{error}</p>}
      {!spaces && !error && <p className="couple-muted">正在读取空间…</p>}
      {spaces && pairs && !isPair && <>
        <section className="couple-card"><h2>他们的空间</h2><p>选两位角色，记录他们自己的故事。</p>
          <div className="couple-actions">
            {[{ value: pairA, set: setPairA, name: '角色 A' }, { value: pairB, set: setPairB, name: '角色 B' }].map(item =>
              <select key={item.name} aria-label={item.name} value={item.value} onChange={event => item.set(event.target.value)}>
                <option value="">{item.name}</option>{characters.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>)}
            <select aria-label="配对关系" value={relation} onChange={event => setRelation(event.target.value as Relation)}>
              {Object.entries(relationNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button disabled={busy || !pairA || !pairB || pairA === pairB} onClick={createPair}>建立空间</button>
          </div>
        </section>
        {pairList.map(item => <div className="couple-card couple-split" key={item.id}>
          <span>{item.members.map(id => characters.find(person => person.id === id)?.name ?? '角色已删除').join(' × ')}<br />
            <small>{relationNames[item.relation]} · {item.entries.length} 条记录</small></span>
          <button disabled={item.members.some(id => !characters.some(person => person.id === id))} onClick={() => setPair(item.members)}>进入</button>
          <button disabled={busy} onClick={() => {
            if (window.confirm('删除这个配对空间和里面的故事？')) void run(async () => { await persist(item.members, () => undefined); });
          }}>删除</button>
        </div>)}
      </>}
      {spaces && !pairs && pickerStep === 'orbit' && <OrbitCharacterPicker
        characters={characters} selectedId={partnerId} status={bond?.status} busy={busy}
        onSelect={id => setPartnerId(id)}
        onContinue={() => setPickerStep(bond?.status === 'open' ? 'space' : 'actions')}
        onPairs={() => setPairs(true)} />}
      {spaces && !pairs && pickerStep === 'actions' && bond?.status !== 'open' && <section className="couple-lock couple-bind-step">
        <div className="couple-avatars"><Avatar person={userProfile} /><Heart weight="duotone" size={25} />{char && <Avatar person={char} />}</div>
        <small className="couple-bind-kicker">RELATIONSHIP · 02</small>
        <h2>与 {char?.name ?? 'TA'} 建立羁绊</h2><p>先选择你们的关系，再决定如何发出邀请。</p>
        <label>关系定位<select value={selectedRelation} disabled={busy || bond?.status === 'pending'} onChange={event => {
          const selected = event.target.value as Relation;
          setRelation(selected);
          if (bond) void run(() => change(current => ({ ...current, relation: selected })));
        }}>{Object.entries(relationNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {bond?.status === 'declined' && <p>{char?.name}婉拒了上一次邀请。</p>}
        {bond?.status === 'pending' && <p>邀请已发出，等待角色回应。</p>}
        <button className="couple-primary" disabled={busy || !char} onClick={() => bind(false)}>{busy ? '等待回应…' : bond?.status === 'pending' ? '获取邀请回应' : '发送绑定申请'}</button>
        <button disabled={busy || !char} onClick={() => bind(true)}>直接建立羁绊</button>
        <button disabled={busy} onClick={() => setPickerStep('orbit')}><CaretLeft size={17} /> 返回角色星轨</button>
      </section>}
      {bond?.status === 'open' && char && (!isPair || other) && (isPair || (!pairs && pickerStep === 'space')) && <>
        {!panel && <>
          <section className="couple-hero">
            {bond.cover && <TokenImg value={bond.cover} className="couple-cover" alt="空间封面"
              style={{ objectPosition: `center ${bond.position ?? 50}%`, transform: `scale(${bond.zoom ?? 1})` }} />}
            <div className="couple-hero-text">
              <small>{relationCopy[bond.relation].name} · {bond.start}</small>
              <div className="couple-avatars"><Avatar person={isPair ? char : userProfile} /><Heart weight="fill" size={22} /><Avatar person={other ?? char} /></div>
              <h2>{names.me} <span>×</span> {names.them}</h2>
              <p>{relationCopy[bond.relation].days} <strong>{days}</strong> 天</p>
              <p>{relationCopy[bond.relation].sub}</p>
            </div>
          </section>
          {isPair ? <section className="couple-card">
            <h3>他们现在</h3><p>亲密度 {bond.pairStats?.intimacy ?? '—'} · 信任 {bond.pairStats?.trust ?? '—'} · 张力 {bond.pairStats?.tension ?? '—'}</p>
            {digest && <p>{digest}</p>}
            <div className="couple-actions">
              <button disabled={busy} onClick={() => void run(async () => {
                const data = await readPairDigest(members);
                setDigest(`共同群聊 ${data.groups.length} 个 · 同场剧情 ${data.scenes.length} 场 · Spark 互动 ${data.posts.length} 条`);
              })}>重新汇整</button>
              <button disabled={busy} onClick={() => void run(async () => {
                const note = window.prompt('想看什么？（可以留空）', '');
                if (note === null) return;
                const result = extractJson(await generate(`以旁观者身份为这两位角色写一则故事，贴合关系设定，生成新内容时标明是演绎。补充要求：${note}。仅返回 JSON {"title":"标题","body":"正文","intimacy":0到100,"trust":0到100,"tension":0到100}。`));
                if (typeof result?.title !== 'string' || typeof result?.body !== 'string' || !result.title.trim() || !result.body.trim()) throw new Error('没有收到有效故事');
                const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 0;
                await change(current => ({ ...current,
                  entries: [...current.entries, createEntry('timeline', result.title, result.body, 'them')],
                  pairStats: { intimacy: score(result.intimacy), trust: score(result.trust), tension: score(result.tension) },
                }));
                setPanel('timeline');
              })}>让 AI 写他们的故事</button>
            </div>
          </section> : <div className="couple-card couple-split">
            <span>Lv.{bondLevel(bond)} · 专属牵绊<br /><small>距下一级 {100 - bondXp(bond) % 100} 点</small></span>
            <select aria-label="切换角色" value={partnerId} onChange={event => { setPartnerId(event.target.value); setPickerStep('orbit'); }}>
              {characters.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </div>}
          {lockedPanel && <section className="couple-card">
            <h3>解锁{labels[lockedPanel]}</h3>
            <p>{bond.gateMode === 'level' ? `牵绊达到 Lv.${panelLevels[lockedPanel] ?? 1} 时自动解锁。` : '可以和角色一起定下使用这个功能的约定。'}</p>
            <div className="couple-actions">
              {bond.gateMode === 'pact' && <button disabled={busy} onClick={() => void run(async () => {
                const terms = window.prompt('想和 TA 定下什么约定？')?.trim().slice(0, 500);
                if (!terms) return;
                const result = extractJson(await generate(`用户想解锁「${labels[lockedPanel]}」，约定是：${terms}。尊重角色性格与边界，独立选择接受或拒绝。仅输出 JSON {"accept":true或false,"reply":"角色的答复"}。`));
                if (typeof result?.accept !== 'boolean' || typeof result?.reply !== 'string' || !result.reply.trim()) throw new Error('没有收到明确回应，可以重试');
                if (result.accept) await change(current => ({
                  ...current, unlocks: { ...current.unlocks, [lockedPanel]: { terms, response: result.reply.trim() } },
                }));
                addToast(result.reply.trim());
                if (result.accept) { setPanel(lockedPanel); setLockedPanel(undefined); }
              })}>提出约定</button>}
              <button disabled={busy} onClick={() => {
                if (!window.confirm(`直接解锁「${labels[lockedPanel]}」？`)) return;
                void run(async () => {
                  await change(current => ({ ...current, unlocks: { ...current.unlocks, [lockedPanel]: { terms: '', response: '' } } }));
                  setPanel(lockedPanel);
                  setLockedPanel(undefined);
                });
              }}>直接解锁</button>
              <button disabled={busy} onClick={() => setLockedPanel(undefined)}>返回</button>
            </div>
          </section>}
          <nav className="couple-grid" aria-label="空间功能">
            {(isPair ? pairPanels : mainPanels).map(id => {
              const Icon = icons[id];
              const locked = !isPair && id !== 'achievements' && !bond.unlocks?.[id] && (bond.gateMode === 'pact' ||
                bond.gateMode === 'level' && bondLevel(bond) < (panelLevels[id] ?? 1));
              return <button key={id} onClick={() => { if (locked) setLockedPanel(id); else { setLockedPanel(undefined); setPanel(id); } }}>
                <Icon size={24} weight="duotone" />{labels[id]}{locked && <small>待解锁</small>}
                {id === 'capsule' && !locked && readyCapsules > 0 && <span className="couple-badge">{readyCapsules} 封可拆</span>}
              </button>;
            })}
          </nav>
        </>}
        {panel && panel in recordNames && <BondRecords key={`${key}:${panel}`} kind={panel as EntryKind} bond={bond}
          names={names} change={change} generate={generate} share={isPair ? undefined : share} busy={busy} />}
        {panel === 'shop' && <BondShop bond={bond} partner={names.them} change={change} generate={generate} share={share} busy={busy} />}
        {panel === 'achievements' && bondAchievements(bond, days).map(item => <div className="couple-card couple-split" key={item.title}>
          <span>{item.count >= item.goal ? item.secret ?? item.title : item.title}<br />
            <small>{item.secret && item.count < item.goal ? '等待发现' : `${Math.min(item.count, item.goal)} / ${item.goal}`}</small>
          </span><Medal size={24} weight={item.count >= item.goal ? 'fill' : 'light'} />
        </div>)}
        {panel === 'plant' && <section className="couple-card">
          <div className="couple-plant" aria-hidden="true">{({ 枯萎: '🍂', 开花: '🌷', 茂盛: '🪴', 嫩芽: '🌱', 种子: '🫘' })[plantStage(bond.plant)]}</div>
          <h3>{plantStage(bond.plant)} · {bond.plant.xp} / 100</h3>
          <progress max={100} value={bond.plant.xp} />
          {bond.plant.lastSide && <p>{names[bond.plant.lastSide]}在 {new Date(bond.plant.watered).toLocaleString()} 浇了水。</p>}
          <div className="couple-actions">
            <button disabled={busy} onClick={() => void run(() => change(current => careForPlant(current, 'water', 'me')))}>浇水</button>
            <button disabled={busy} onClick={() => void run(() => change(current => careForPlant(current, 'fertilize', 'me')))}>施肥</button>
            {!isPair && <button disabled={busy} onClick={() => void run(async () => {
              const result = extractJson(await generate('对方邀请你照顾两人种的盆栽。按角色决定是否浇水。仅输出 JSON {"water":true或false,"reply":"你的回应"}。'));
              if (typeof result?.water !== 'boolean') throw new Error('没有收到明确答复');
              if (result.water) await change(current => careForPlant(current, 'water', 'them'));
              addToast(typeof result.reply === 'string' ? result.reply : (result.water ? '角色帮你浇水了' : '角色暂时没有浇水'));
            })}>请 {names.them} 照料</button>}
            {plantStage(bond.plant) === '枯萎' && <button disabled={busy} onClick={() => void run(() => change(current => ({
              ...current, plant: { ...current.plant, xp: 0, watered: Date.now(), cycleWaters: 0, lastSide: undefined, fertilized: undefined },
            })))}>重新播种</button>}
            {plantStage(bond.plant) === '开花' && <button disabled={busy} onClick={() => void run(() => change(current => {
              if (plantStage(current.plant) !== '开花') throw new Error('现在还没有可收下的花');
              const varieties = ['雏菊', '郁金香', '洋桔梗', '风信子'];
              const name = varieties[(current.flowers?.length ?? 0) % varieties.length];
              const date = dayKey();
              return { ...current, plant: { ...current.plant, xp: 0, watered: Date.now(), cycleWaters: 0, lastSide: undefined, fertilized: undefined },
                flowers: [...(current.flowers ?? []), { id: crypto.randomUUID(), name, date, from: 'me' }],
                entries: [...current.entries, createEntry('gift', name, `一起养开的花，送给 ${names.them}`)] };
            }))}>收花并送给 {names.them}</button>}
          </div>
          <small>浇水间隔 4 小时，施肥间隔 1 天。连续 3 天没浇水会枯萎。</small>
          {!isPair && <label><input type="checkbox" checked={!!bond.plantAuto} disabled={busy} onChange={event => {
            const plantAuto = event.target.checked;
            void run(() => change(current => ({ ...current, plantAuto })));
          }} /> 允许角色在私聊后顺手照料盆栽</label>}
          <h3 className="mt-4">花朵图鉴</h3>
          {bond.flowers?.length ? bond.flowers.map(flower => <p key={flower.id}>{flower.name} · {flower.date} · {names[flower.from]}送出</p>)
            : <p className="couple-muted">收下第一朵花后，这里会留下纪念。</p>}
        </section>}
        {panel === 'touch' && <TouchPanel key={key} bond={bond} char={char} apiConfig={apiConfig} busy={busy} run={run} change={change} generate={generate} upload={upload} />}
        {panel === 'settings' && <section className="couple-card">
          <label>羁绊类型<select value={bond.relation} disabled={busy} onChange={event => {
            const next = event.target.value as Relation;
            void run(() => change(current => ({ ...current, relation: next })));
          }}>{Object.entries(relationNames).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          {!isPair && <label>功能解锁方式<select value={bond.gateMode ?? 'open'} disabled={busy} onChange={event => {
            const gateMode = event.target.value as Bond['gateMode'];
            void run(() => change(current => ({ ...current, gateMode })));
          }}><option value="open">全部开放</option><option value="level">随牵绊等级解锁</option><option value="pact">与角色约定后解锁</option></select></label>}
          <label>纪念日<input type="date" value={bond.start} disabled={busy} onChange={event => {
            const start = event.target.value;
            if (start) void run(() => change(current => ({ ...current, start })));
          }} /></label>
          <label>更换封面<input type="file" accept="image/*" disabled={busy} onChange={event => upload(event.target.files?.[0], 'cover')} /></label>
          <div className="couple-actions">
            <button disabled={busy} onClick={() => void run(async () => setGallery(gallery ? undefined : (await DB.getGalleryImages()).slice(-48).reverse()))}>
              {gallery ? '关闭相册' : '从相册选封面'}
            </button>
            <button disabled={busy} onClick={() => void run(async () => {
              const style = window.prompt('想要什么样的合照？例如日常抓拍、影楼棚拍、电影感。', '日常抓拍');
              if (style === null) return;
              const controller = new AbortController();
              requestRef.current = controller;
              const timer = window.setTimeout(() => controller.abort(), 90_000);
              try {
                const cover = await generateBondArtwork(char, other ?? userProfile, bond.relation, style, controller.signal, !!other);
                await change(current => ({ ...current, cover, zoom: 1, position: 50 }));
              } finally { clearTimeout(timer); requestRef.current = undefined; }
            })}>AI 生成封面</button>
            {bond.cover && <button disabled={busy} onClick={() => void run(() => change(current => ({ ...current, cover: undefined })))}>移除封面</button>}
          </div>
          {gallery && <div className="couple-grid">{gallery.length ? gallery.map(photo =>
            <button key={photo.id} disabled={busy} onClick={() => void run(async () => {
              await change(current => ({ ...current, cover: photo.url, zoom: 1, position: 50 }));
              setGallery(undefined);
            })}><TokenImg value={photo.url} className="couple-record-image" alt={photo.savedDate ?? '相册照片'} /></button>)
            : <p className="couple-muted">相册还没有照片。</p>}</div>}
          {bond.cover && <>
            <label>封面位置<input type="range" min={0} max={100} defaultValue={bond.position ?? 50} onPointerUp={event => {
              const position = Number(event.currentTarget.value);
              void run(() => change(current => ({ ...current, position })));
            }} onKeyUp={event => {
              const position = Number(event.currentTarget.value);
              if (position !== bond.position) void run(() => change(current => ({ ...current, position })));
            }} /></label>
            <label>封面缩放<input type="range" min={1} max={2} step={0.05} defaultValue={bond.zoom ?? 1} onPointerUp={event => {
              const zoom = Number(event.currentTarget.value);
              void run(() => change(current => ({ ...current, zoom })));
            }} onKeyUp={event => {
              const zoom = Number(event.currentTarget.value);
              if (zoom !== bond.zoom) void run(() => change(current => ({ ...current, zoom })));
            }} /></label>
          </>}
          <div className="couple-actions">
            <button disabled={busy} onClick={() => { setPanel(undefined); if (isPair) setPair([]); else setPairs(true); }}>{isPair ? '更换配对' : '他们的空间'}</button>
            <button disabled={busy} onClick={() => {
              if (window.confirm('重置当前空间？空间内的记录和积分会清除。')) void run(async () => {
                await persist(members, current => current?.id === bond.id ? undefined : current);
                setPanel(undefined);
                if (isPair) setPair([]);
              });
            }}>重置空间</button>
          </div>
        </section>}
      </>}
    </main>
  </div>;
}

function TouchPanel({ bond, char, apiConfig, busy, run, change, generate, upload }: {
  bond: Bond; char: CharacterProfile; apiConfig: APIConfig; busy: boolean; run: (task: () => Promise<void>) => void;
  change: ChangeBond; generate: (instruction: string) => Promise<string>;
  upload: (file: File | undefined, field: 'portrait') => void;
}) {
  const [prop, setProp] = useState('手');
  const [reaction, setReaction] = useState('');
  const [calibration, setCalibration] = useState<string>();
  const [voice, setVoice] = useState('');
  const [full, setFull] = useState(false);
  const portraitRequest = useRef<AbortController>();
  const startPoint = useRef<{ x: number; y: number }>();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const portraitValue = bond.portrait || resolveCompanionPortrait(char) || listCompanionDateOutfits(char)[0]?.preview;
  const portrait = portraitValue && !failedImages.includes(portraitValue) ? portraitValue : undefined;
  const displayImage = portrait || (!failedImages.includes(char.avatar) ? char.avatar : undefined);
  useEffect(() => () => portraitRequest.current?.abort(), []);
  useEffect(() => () => { if (voice.startsWith('blob:')) URL.revokeObjectURL(voice); }, [voice]);
  const zones = ['头发', '脸颊', '肩膀', '手'];
  useLocalBackHandler(() => {
    if (!full) return false;
    setFull(false);
    return true;
  }, 30);
  const tools = ['手', '羽毛', '冰块', '绳子', '毛笔', '唇', '眼罩', '轻拍'];
  const touch = (bodyPart: string) => run(async () => {
    const key = `${prop}:${bodyPart}`;
    const text = bond.touchLines?.[key] ?? await generate(
      `在专属贴贴里，用户想用「${prop}」轻碰你的「${bodyPart}」。按人设、关系和同意边界给出一到三句当下回应。可以接受、移开或拒绝。`,
    );
    await change(current => reward({
      ...current, touches: current.touches + 1, touchLines: { ...current.touchLines, [key]: text },
    }, `touch:${dayKey()}`, 5));
    setReaction(text);
    setVoice('');
  });
  return <section className={`couple-card${full ? ' couple-touch-full' : ''}`}>
    <div className="couple-actions">
      <button onClick={() => setFull(!full)}>{full ? '退出全屏' : '全屏'}</button>
      <button disabled={busy} onClick={() => run(async () => {
        const pose = window.prompt('想让角色用什么姿势？', '自然站立');
        if (pose === null) return;
        const controller = new AbortController();
        portraitRequest.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 90_000);
        try {
          const portrait = await generateBondPortrait(char, pose, controller.signal);
          await change(current => ({ ...current, portrait, touchCalibration: {} }));
        } finally { clearTimeout(timer); portraitRequest.current = undefined; }
      })}>AI 生成立绘</button>
      {bond.portrait && <button disabled={busy} onClick={() => run(() => change(current => ({ ...current, portrait: undefined, touchCalibration: {} })))}>移除立绘</button>}
    </div>
    <label className="couple-file">
      <span>{bond.portrait ? '更换本地立绘' : '选择本地立绘'}</span>
      <input type="file" accept="image/*" disabled={busy} onChange={event => upload(event.target.files?.[0], 'portrait')} />
    </label>
    <details>
      <summary>贴贴背景音乐</summary>
      <label>本地音频<input type="file" accept="audio/*" disabled={busy} onChange={event => {
        const file = event.target.files?.[0];
        if (file) run(async () => {
          if (!file.type.startsWith('audio/') || file.size > 8 * 1024 * 1024) throw new Error('请选择 8 MB 以内的音频');
          const { blobToDataUrl } = await import('../utils/blobRef');
          const touchBgm = await blobToDataUrl(file);
          await change(current => ({ ...current, touchBgm }));
        });
      }} /></label>
      {bond.touchBgm && <div className="couple-actions"><audio className="max-w-full" src={bond.touchBgm} controls loop />
        <button disabled={busy} onClick={() => run(() => change(current => ({ ...current, touchBgm: undefined })))}>移除音乐</button>
      </div>}
    </details>
    {portrait && <label>触摸点校准<select value={calibration ?? ''} disabled={busy} onChange={event => setCalibration(event.target.value || undefined)}>
      <option value="">按立绘位置识别</option>{zones.map(part => <option key={part} value={part}>校准{part}</option>)}
    </select></label>}
    <div className={`couple-portrait${portrait ? ' couple-portrait-interactive' : ''}`}>
      {displayImage ? <TokenImg value={displayImage} alt={char.name} draggable={false}
        onError={() => setFailedImages(current => [...new Set([...current, displayImage])])}
        onPointerDown={event => { startPoint.current = { x: event.clientX, y: event.clientY }; }}
        onPointerCancel={() => { startPoint.current = undefined; }}
        onPointerUp={event => {
          const start = startPoint.current;
          startPoint.current = undefined;
          if (!portrait || busy || !start || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 12) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = (event.clientY - rect.top) / rect.height;
          if (x < 0 || x > 1 || y < 0 || y > 1) return;
          if (calibration) {
            run(async () => {
              await change(current => ({ ...current, touchCalibration: { ...current.touchCalibration, [calibration]: { x: x * 100, y: y * 100 } } }));
              setCalibration(undefined);
            });
            return;
          }
          const part = resolveAvatarTouchTarget([], y, x).part;
          touch(part === 'hair' ? '头发' : part === 'face' ? '脸颊' : avatarTouchPartLabel(part));
        }} /> : <div className="couple-portrait-empty">
          <HandHeart size={24} weight="duotone" aria-hidden />
          <span>选一张立绘，或直接使用下方的部位按钮。</span>
        </div>}
      {portrait && !calibration && zones.filter(part => bond.touchCalibration?.[part]).map(part => {
        const point = bond.touchCalibration![part];
        return <button key={part} type="button" className="couple-hotspot"
          style={{ top: `${point.y}%`, left: `${point.x}%` }} disabled={busy} onClick={() => touch(part)}>{part}</button>;
      })}
    </div>
    {portrait && <small>{calibration ? `点一下立绘上的${calibration}` : '轻点立绘，或用下方部位按钮互动。'}</small>}
    <div className="couple-actions">
      {[...tools, ...(bond.touchProps ?? [])].map((item, index) => <button key={item} aria-pressed={prop === item}
        disabled={busy || index < tools.length && index > Math.floor(bond.touches / 4)} onClick={() => setProp(item)}>
        {item}{index < tools.length && index > Math.floor(bond.touches / 4) ? ' · 未解锁' : ''}
      </button>)}
      <button disabled={busy} onClick={() => {
        const name = window.prompt('自订道具名称')?.trim().slice(0, 35);
        if (!name || tools.includes(name)) return;
        run(() => change(current => ({ ...current, touchProps: [...new Set([...(current.touchProps ?? []), name])] })));
      }}>自订道具</button>
    </div>
    {!calibration && <div className="couple-actions" aria-label="触碰部位">{zones.map(part =>
      <button key={part} disabled={busy} onClick={() => touch(part)}>{part}</button>)}</div>}
    {reaction && <><p aria-live="polite">{reaction}</p>
      {voice ? <audio src={voice} controls autoPlay /> : <button disabled={busy} onClick={() => run(async () => {
        const { synthesizeSpeech } = await import('../utils/ttsRouter');
        setVoice(await synthesizeSpeech(reaction, char, apiConfig));
      })}>播放角色语音</button>}</>}
    <div className="couple-actions"><button disabled={busy || !Object.keys(bond.touchLines ?? {}).length} onClick={() => {
      run(() => change(current => ({ ...current, touchLines: {} })));
      setReaction('');
    }}>重新生成台词</button></div>
  </section>;
}
