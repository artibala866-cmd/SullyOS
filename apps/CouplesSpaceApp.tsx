import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CaretLeft, CaretRight, ArrowRight, GearSix, HandHeart, Heart, Users } from '@phosphor-icons/react';
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
import { capsuleStatus, createBond, createEntry, dayKey, daysTogether, readSpaces, relationNames, setBondOpen, reward, spaceKey, writeBond, careForPlant, collectPlantDroplets, harvestPlant, replantBond, touchPortraitSlots, pairCoverStyles, plantCareWait, isRecentPlantWatering, PLANT_WATER_NOTICE_MS, plantStage, bondLevel, panelLevels, type Bond, type EntryKind, type Relation } from '../utils/couplesSpace';
import { BondRecords, recordNames, type ChangeBond } from './couplesSpace/records';
import { BondShop, bondAchievements } from './couplesSpace/shop';
import { generateBondText, generateBondArtwork, generateBondPortrait, readPairDigest, detectBondPortraitAnchors, loadBondMilestoneSources } from '../utils/couplesGeneration';
import './couplesSpace/couplesSpace.css';
import './couplesSpace/timelineCinema.css';
import './couplesSpace/wishConstellation.css';

type Panel = EntryKind | 'settings' | 'shop' | 'achievements' | 'plant' | 'touch';
const labels = { ...recordNames, settings: '空间设置', shop: '羁绊商店', achievements: '成就墙', plant: '同频阳台', touch: '专属贴贴' };
const relationshipCopy = {
  love: { days: '在一起', title: '我们的日常', care: '留给你的心意', collection: '我们的收藏' },
  family: { days: '家人相伴', title: '家里的日常', care: '给家人的心意', collection: '家里的收藏' },
  friend: { days: '成为朋友', title: '朋友间的日常', care: '留给朋友的心意', collection: '友情纪念册' },
};
const mainPanels: Panel[] = ['timeline', 'anniversary', 'wish', 'gift', 'touch', 'plant', 'mail', 'capsule', 'shop', 'achievements', 'hollow'];
const pairPanels: Panel[] = ['timeline', 'anniversary', 'mail', 'wish', 'gift', 'plant', 'achievements'];
type SpaceShelf = 'memory' | 'care' | 'collection';
const spaceShelves: { id: SpaceShelf; title: string; english: string; panels: Panel[] }[] = [
  { id: 'memory', title: '日常', english: 'MEMORIES', panels: ['timeline','anniversary','mail','capsule','hollow'] },
  { id: 'care', title: '心意', english: 'BETWEEN US', panels: ['wish','gift','touch','plant'] },
  { id: 'collection', title: '收藏', english: 'COLLECTION', panels: ['shop','achievements'] },
];
const featureNotes: Partial<Record<Panel, string>> = {
  timeline: '写下每一个值得记住的瞬间', anniversary: '在特别的日子里相见',
  mail: '等一封写给你的信',
  capsule: '留一句话，给未来的我们', hollow: '藏起不便说出口的心事',
  wish: '一件件完成心里的期待', gift: '把温柔装进一份礼物',
  touch: '只属于彼此的小互动', plant: '一起养成一片小小的绿意',
  shop: '交换有趣的专属羁绊', achievements: '收藏共同完成的成就',
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
  const touchStart = useRef<{ x: number; y: number }>();
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragProgress = Math.max(-1, Math.min(1, dragPx / 115));
  const shift = (step: number) => {
    if (characters.length > 1) onSelect(characters[(activeIndex + step + characters.length) % characters.length].id);
  };
  return <section className="couple-picker" aria-label="环绕星球角色选择">
    <div className="couple-picker-intro">
      <span className="couple-picker-overline"><Heart size={13} weight="fill" /> OUR LITTLE UNIVERSE</span>
      <h2>情侣空间</h2><p>在星轨之间，找到想要连接的 TA</p>
    </div>
    {active ? <>
      <div className={'couple-orbit-scene' + (dragging ? ' couple-orbit-dragging' : '')}
        aria-label="左右滑动星轨或点击头像切换角色"
        onTouchStart={event => {
          const touch = event.touches[0];
          if (touch) { touchStart.current = { x: touch.clientX, y: touch.clientY }; setDragging(false); }
        }}
        onTouchMove={event => {
          const touch = event.touches[0];
          const start = touchStart.current;
          if (!touch || !start) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy) * 1.15) {
            setDragging(true);
            setDragPx(Math.max(-115, Math.min(115, dx)));
          }
        }}
        onTouchCancel={() => { touchStart.current = undefined; setDragging(false); setDragPx(0); }}
        onTouchEnd={event => {
          const start = touchStart.current;
          touchStart.current = undefined;
          if (!start) return;
          const dx = (event.changedTouches[0]?.clientX ?? start.x) - start.x;
          const dy = (event.changedTouches[0]?.clientY ?? start.y) - start.y;
          if (Math.abs(dx) > 38 && Math.abs(dx) > Math.abs(dy) * 1.1) {
            event.preventDefault();
            shift(dx < 0 ? 1 : -1);
          }
          setDragging(false);
          setDragPx(0);
        }}>
        <div className="couple-orbit-aura" aria-hidden="true" />
        <div className="couple-orbit-track couple-orbit-track-back" aria-hidden="true" />
        <div className="couple-orbit-track couple-orbit-track-front" aria-hidden="true" />
        <div className="couple-orbit-core" key={active.id} aria-label={'当前角色：' + active.name}
          style={{ transform: 'translate(-50%, -50%) translate3d(' + (-dragProgress * 20) + 'px, 0, 42px) rotateY(' + (-dragProgress * 14) + 'deg) scale(' + (1 - Math.abs(dragProgress) * .07) + ')' }}>
          <Avatar person={active} />
          <span className="couple-orbit-core-halo" aria-hidden="true" />
        </div>
        {characters.map((person, index) => {
          const forward = (index - activeIndex + characters.length) % characters.length;
          const offset = forward <= characters.length / 2 ? forward : forward - characters.length;
          if (!offset || Math.abs(offset) > 2) return null;
          const angle = Math.PI * 2 * (offset - dragProgress * .72) / 5;
          const depth = (Math.cos(angle) + 1) / 2;
          return <button type="button" className="couple-orbit-satellite" key={person.id}
            aria-label={'选择角色：' + person.name} disabled={busy}
            onClick={() => onSelect(person.id)}
            style={{
              left: (50 + Math.sin(angle) * 39) + '%',
              top: (51 + Math.cos(angle) * 18) + '%',
              transform: 'translate(-50%, -50%) translateZ(' + Math.round((depth - .4) * 80) + 'px) rotateY(' + (-Math.sin(angle) * 25) + 'deg) scale(' + (.72 + depth * .27) + ')',
              opacity: .73 + depth * .27,
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
          <small>{status === 'open' ? '专属空间已建立' : status === 'pending' ? '有一份等待回应的邀请' : status === 'closed' ? '空间已关闭，记录仍保留' : status === 'declined' ? '可重新发出邀请' : '等待与你建立专属连接'}</small>
        </div>
        <span className="couple-picker-state">{status === 'open' ? '已绑定' : status === 'pending' ? '待回应' : status === 'closed' ? '已关闭' : '待绑定'}</span>
      </div>
      <button type="button" className="couple-picker-confirm" disabled={busy} onClick={onContinue}>
        {status === 'open' ? '进入专属空间' : status === 'pending' ? '查看邀请' : status === 'closed' ? '查看空间状态' : '选择此角色'} <ArrowRight size={18} />
      </button>
      <button type="button" className="couple-picker-pairs" disabled={busy} onClick={onPairs}><Users size={18} /> 他们的空间</button>
      <p className="couple-picker-hint">滑动星轨切换 · 点击确认后继续</p>
    </> : <div className="couple-picker-empty">
      <Heart size={32} weight="thin" /><p>还没有可以绑定的角色</p>
      <small>先创建角色，再回来开启你们的空间。</small>
    </div>}
  </section>;
}

export default function CouplesSpaceApp() {
  const { closeApp, openApp, characters, activeCharacterId, setActiveCharacterId, userProfile, apiConfig, addToast } = useOS();
  const [partnerId, setPartnerId] = useState(() => characters.some(item => item.id === activeCharacterId) ? (activeCharacterId || '') : (characters[0]?.id || ''));
  const [pickerStep, setPickerStep] = useState<'orbit' | 'actions' | 'space'>('orbit');
  const [pairs, setPairs] = useState(false);
  const [pair, setPair] = useState<string[]>([]);
  const [pairA, setPairA] = useState('');
  const [pairB, setPairB] = useState('');
  const [panel, setPanel] = useState<Panel>();
  const [pairCoverStyle, setPairCoverStyle] = useState<typeof pairCoverStyles[number]>('日常互动');
  const [milestoneFilter, setMilestoneFilter] = useState('all');
  const [milestoneSources, setMilestoneSources] = useState<Bond['milestones']>();
  const [milestoneDraft, setMilestoneDraft] = useState<NonNullable<Bond['milestones']>[number]>();
  const [activeShelf, setActiveShelf] = useState<SpaceShelf>('memory');
  const [lockedPanel, setLockedPanel] = useState<Panel>();
  const [spaces, setSpaces] = useState<Awaited<ReturnType<typeof readSpaces>>>();
  const [relation, setRelation] = useState<Relation>('love');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plantNow, setPlantNow] = useState(() => Date.now());
  const readRevision = useRef(0);
  const [digest, setDigest] = useState<string>();
  const [gallery, setGallery] = useState<GalleryImage[]>();
  const requestRef = useRef<AbortController>();
  const loading = useRef(false);
  const withdrawing = useRef(false);
  const withdrawnId = useRef<string>();
  const [withdrawingInvite, setWithdrawingInvite] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const scroll = useRef<HTMLElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const recordBack = useRef<(() => boolean) | undefined>(undefined);
  const isPair = pairs && pair.length === 2;
  const members = pairs ? pair : [partnerId];
  const key = spaceKey(members);
  const bond = spaces?.[key];
  const char = characters.find(item => item.id === (isPair ? pair[0] : partnerId));
  const other = isPair ? characters.find(item => item.id === pair[1]) : undefined;
  const names = isPair ? { me: char?.name ?? '角色 A', them: other?.name ?? '角色 B' } :
    { me: userProfile.name || '我', them: char?.name ?? 'TA' };
  const selectedRelation = bond?.relation ?? relation;
  const relationship = relationshipCopy[selectedRelation];
  const days = bond ? daysTogether(bond.start) : 0;
  const today = useLocalDateKey();
  const readyCapsules = bond?.entries.filter(item => item.kind === 'capsule' && capsuleStatus(item, today) === 'ready').length ?? 0;
  const plantStageNow = bond ? plantStage(bond.plant, plantNow) : '种子';
  const waterWait = bond ? plantCareWait(bond.plant, 'water', plantNow) : Infinity;
  const feedWait = bond ? plantCareWait(bond.plant, 'fertilize', plantNow) : Infinity;
  const careWaitLabel = (ms: number) => {
    if (!Number.isFinite(ms)) return '需重新播种';
    if (ms <= 0) return '现在可以';
    const minutes = Math.ceil(ms / 60_000);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}小时${minutes % 60 ? `${minutes % 60}分` : ''}后` : `${minutes}分钟后`;
  };
  const waterAge = bond ? Math.max(0, plantNow - bond.plant.watered) : Infinity;
  const recentWater = !!bond && isRecentPlantWatering(bond.plant, plantNow);

  useEffect(() => {
    let active = true;
    const load = () => {
      const revision = readRevision.current;
      void readSpaces().then(value => {
        if (active && revision === readRevision.current) setSpaces(value);
      }, () => {
        if (active && revision === readRevision.current) setError('情侣空间读取失败，请重新打开');
      });
    };
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      requestRef.current?.abort();
    };
  }, []);
  useEffect(() => { setError(''); setDigest(undefined); setMilestoneDraft(undefined); setMilestoneSources(undefined); setMilestoneFilter('all'); setPairCoverStyle('日常互动'); }, [key]);
  // Visual-only garden clock: recheck minute-scale cooldowns, and expire a
  // transient watering notice exactly on time without rerendering the app each second.
  useEffect(() => {
    if (panel !== 'plant') return;
    const refresh = () => setPlantNow(Date.now());
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    const age = Date.now() - (bond?.plant.watered ?? 0);
    const remaining = bond && isRecentPlantWatering(bond.plant) ? PLANT_WATER_NOTICE_MS - age : 0;
    const expiry = remaining > 0 ? window.setTimeout(refresh, remaining + 15) : undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      if (expiry !== undefined) window.clearTimeout(expiry);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [panel, bond?.plant.watered, bond?.plant.lastSide]);
  useEffect(() => {
    if (characters.length && !characters.some(item => item.id === partnerId)) {
      setPartnerId(characters[0].id);
      setPickerStep('orbit');
    }
  }, [characters, partnerId]);
  useEffect(() => {
    if (!spaces || pairs || pickerStep === 'orbit') return;
    if (pickerStep === 'space' && bond?.status !== 'open') {
      setPanel(undefined);
      setConfirmClose(false);
      setLockedPanel(undefined);
      setGallery(undefined);
      setPickerStep('actions');
    } else if (pickerStep === 'actions' && bond?.status === 'open') {
      setPickerStep('space');
    }
  }, [spaces, pairs, pickerStep, bond?.status]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [panel, key, pairs, pickerStep]);
  useEffect(() => {
    if (confirmClose) confirmation.current?.scrollIntoView?.({ block: 'nearest' });
  }, [confirmClose]);
  const back = () => {
    if (withdrawingInvite) return true;
    if (confirmClose && !busy) { setConfirmClose(false); return true; }
    if (busy) return true;
    if (lockedPanel) { setLockedPanel(undefined); return true; }
    if (panel) { if (!recordBack.current?.()) setPanel(undefined); return true; }
    if (isPair) { setPair([]); return true; }
    if (pairs) { setPairs(false); setPickerStep('orbit'); return true; }
    if (pickerStep !== 'orbit') { setPickerStep('orbit'); return true; }
    return false;
  };
  useLocalBackHandler(back, 25);

  const persist = async (ids: string[], update: (current: Bond | undefined) => Bond | undefined) => {
    // Ignore a focus-refresh which began before this atomic write.
    readRevision.current++;
    const entry = await writeBond(ids, update);
    readRevision.current++;
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
      if (current?.id !== bond.id || current.status !== bond.status) throw new Error('空间状态已变化，请重新进入');
      return update(current);
    });
  };
  const run = async (task: () => Promise<void>) => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError('');
    try { await task(); } catch (e) {
      const message = e instanceof Error ? e.message : '操作失败，请重试';
      setError(message);
      addToast(message);
    }
    finally { loading.current = false; setBusy(false); }
  };
  const generate = async (instruction: string, current = bond, timelineDate?: string, cancel?: AbortSignal) => {
    if (!char || !current || (isPair && !other)) throw new Error('请先选择角色');
    if (!isPair && (characterBlocksUser(char.chatBlock) || userBlocksCharacter(char.chatBlock))) throw new Error('当前私聊已拉黑，无法请求角色回应');
    if (requestRef.current) throw new Error('角色正在回应');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (cancel?.aborted) abort();
    else cancel?.addEventListener('abort', abort, { once: true });
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const currentCharacter = await DB.getCharacter(char.id);
      if (!currentCharacter || (!isPair && (characterBlocksUser(currentCharacter.chatBlock) || userBlocksCharacter(currentCharacter.chatBlock))))
        throw new Error('角色已移除或私聊当前不可用');
      if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      return await generateBondText(currentCharacter, other ? { name: other.name, avatar: other.avatar, bio: '' } : userProfile,
        apiConfig, current, instruction, controller.signal, other, timelineDate);
    } finally { clearTimeout(timer); cancel?.removeEventListener('abort', abort); requestRef.current = undefined; }
  };
  const openChat = () => {
    if (!char || isPair) return;
    setActiveCharacterId(char.id);
    openApp(AppID.Chat);
  };
  const share = async (content: string, label = '时光信箱', deliveryId?: string) => {
    if (isPair || !char) throw new Error('他们的空间属于这两位角色');
    const latest = await DB.getCharacter(char.id);
    if (!latest || characterBlocksUser(latest.chatBlock)) throw new Error('当前无法发给这个角色');
    const message = { charId: char.id, role: 'user' as const, type: 'text' as const,
      content, metadata: { couplesSpace: { label } } };
    if (deliveryId) await DB.saveMessageOnce(deliveryId, message);
    else await DB.saveMessage(message);
    openChat();
  };
  const bind = (direct: boolean) => void run(async () => {
    if (!char || !spaces) return;
    if (!direct && (characterBlocksUser(char.chatBlock) || userBlocksCharacter(char.chatBlock))) throw new Error('当前私聊已拉黑，无法发送绑定申请');
    if (direct && !window.confirm(`以「${relationNames[selectedRelation]}」关系建立和 ${char.name} 的空间？`)) return;
    const pending = await persist(members, current => {
      if (current?.status === 'open' || current?.status === 'closed') return current;
      const next = current?.status === 'pending' ? current : { ...createBond(members, selectedRelation), ...current, id: crypto.randomUUID() };
      return { ...next, status: direct ? 'open' : 'pending', start: dayKey() };
    });
    if (!pending || pending.status === 'closed') return;
    if (direct || pending.status === 'open') { setPickerStep('space'); return; }
    await DB.saveMessageOnce(`couples-invite:${pending.id}`, {
      charId: char.id, role: 'user', type: 'text',
      content: `【情侣空间邀请】我想和你建立一个${relationNames[pending.relation]}空间，你愿意吗？`, metadata: { couplesSpace: { label: '绑定邀请' } },
    });
    if (withdrawnId.current === pending.id) return;
    let rawResponse: string;
    try { rawResponse = await generate(`用户邀请你建立${relationNames[pending.relation]}空间。依据真实关系和角色性格独立选择接受或拒绝。仅输出 JSON {"accept":true或false,"reply":"角色给用户的自然答复"}。`, pending); }
    catch (error) { if (withdrawnId.current === pending.id) return; throw error; }
    if (withdrawnId.current === pending.id) return;
    const response = extractJson(rawResponse);
    if (typeof response?.accept !== 'boolean' || typeof response?.reply !== 'string' || !response.reply.trim()) throw new Error('没有读到明确答复，可以继续等待或重试');
    const latest = await DB.getCharacter(char.id);
    if (!latest || characterBlocksUser(latest.chatBlock) || userBlocksCharacter(latest.chatBlock)) throw new Error('当前私聊无法接收绑定答复');
    const updated = await persist(members, current => withdrawnId.current !== pending.id && current?.id === pending.id && current.status === 'pending'
      ? { ...current, status: response.accept ? 'open' : 'declined' } : current);
    if (withdrawnId.current === pending.id || updated?.id !== pending.id || updated.status !== (response.accept ? 'open' : 'declined')) return;
    await DB.saveMessageOnce(`couples-invite-reply:${pending.id}`, {
      charId: char.id, role: 'assistant', type: 'text',
      content: `【${response.accept ? '接受邀请' : '婉拒邀请'}】${response.reply.trim()}`, metadata: { couplesSpace: { label: '邀请答复' } },
    });
    if (response.accept) setPickerStep('space');
    openChat();
  });
  const withdrawInvite = async () => {
    if (!bond || bond.status !== 'pending' || withdrawing.current) return;
    withdrawing.current = true;
    withdrawnId.current = bond.id;
    setWithdrawingInvite(true);
    setError('');
    requestRef.current?.abort();
    try {
      const remaining = await persist(members, current =>
        current?.id === bond.id && current.status === 'pending' ? undefined : current);
      if (remaining) throw new Error('邀请状态已变化，请返回查看');
      setRelation(bond.relation);
      addToast('已撤回绑定邀请');
    } catch (error) {
      setError(error instanceof Error ? error.message : '撤回邀请失败，请重试');
    } finally {
      withdrawing.current = false;
      setWithdrawingInvite(false);
    }
  };
  const toggleSpace = (open: boolean) => void run(async () => {
    if (!bond) return;
    const next = await persist(members, current => current?.id === bond.id ? setBondOpen(current, open) : current);
    if (next?.status !== (open ? 'open' : 'closed')) throw new Error('空间状态已变化，请返回查看');
    setPanel(undefined);
    setConfirmClose(false);
    setGallery(undefined);
    setLockedPanel(undefined);
    setPickerStep(open ? 'space' : 'actions');
    addToast(open ? '已重新开启情侣空间' : '已解除情侣空间绑定');
  });
  const upload = (file: File | undefined, field: 'cover' | 'portrait') => {
    if (file) void run(async () => {
      if (file.size > 12 * 1024 * 1024) throw new Error('请选择 12 MB 以内的图片');
      const image = await processImage(file, { maxWidth: 1000 });
      await change(current => ({ ...current, [field]: image, ...(field === 'cover' ? { position: 50, zoom: 1 } : { touchCalibration: {} }) }));
    });
  };
  const createPair = () => void run(async () => {
    if (!pairA || !pairB || pairA === pairB) return;
    const ids = [pairA, pairB];
    const existingOrNew = await persist(ids, current => current ?? createBond(ids, relation));
    if (existingOrNew) setPair(existingOrNew.members);
  });
  const pairList = Object.values(spaces ?? {}).filter(item => item.members.length === 2);
  const headerTitle = panel === 'timeline' || panel === 'wish' ? '情侣空间' : panel ? labels[panel] : pairs ? '他们的空间' : pickerStep === 'orbit' ? '' : '情侣空间';


  const shelf = spaceShelves.find(section => section.id === activeShelf) ?? spaceShelves[0];
  const visibleShelfPanels = shelf.panels.filter(id => (isPair ? pairPanels : mainPanels).includes(id));
  const goToFeature = (id: Panel) => {
    if (!bond) return;
    const locked = !isPair && id !== 'achievements' && !bond.unlocks?.[id] &&
      (bond.gateMode === 'pact' || (bond.gateMode === 'level' && bondLevel(bond) < (panelLevels[id] ?? 1)));
    if (locked) setLockedPanel(id);
    else { setLockedPanel(undefined); setPanel(id); }
  };
  const featureStatus = (id: Panel) => {
    if (!bond) return '';
    const locked = !isPair && id !== 'achievements' && !bond.unlocks?.[id] &&
      (bond.gateMode === 'pact' || (bond.gateMode === 'level' && bondLevel(bond) < (panelLevels[id] ?? 1)));
    if (locked) return '待解锁';
    if (id === 'capsule' && readyCapsules) return readyCapsules + ' 封可拆';
    if (id in recordNames) return bond.entries.filter(item => item.kind === id).length + ' 条';
    return '';
  };

  return <div className={'couple-app' + (!pairs && !panel && pickerStep !== 'space' && !(pickerStep === 'actions' && bond?.status === 'closed') ? ' couple-picker-mode' : ' couple-content-mode')}>
    <header className="couple-header">
      <button aria-label="返回" onClick={() => { if (!back()) closeApp(); }}><ArrowLeft size={20} /></button>
      <h1>{headerTitle}</h1>
      {bond?.status === 'open' && !panel && (isPair || (!pairs && pickerStep === 'space')) ? <button aria-label="空间设置" onClick={() => setPanel('settings')}><GearSix size={21} /></button> : <span />}
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
            if (window.confirm('删除这个配对空间和里面的故事？')) void run(async () => { await persist(item.members, current => {
              if (current?.id !== item.id) throw new Error('配对空间已变化，请刷新后再删除');
              return undefined;
            }); });
          }}>删除</button>
        </div>)}
      </>}
      {spaces && !pairs && pickerStep === 'orbit' && <OrbitCharacterPicker
        characters={characters} selectedId={partnerId} status={bond?.status} busy={busy}
        onSelect={id => setPartnerId(id)}
        onContinue={() => setPickerStep(bond?.status === 'open' ? 'space' : 'actions')}
        onPairs={() => setPairs(true)} />}
      {spaces && !pairs && pickerStep === 'actions' && bond?.status !== 'open' && bond?.status !== 'closed' && <section className="couple-lock couple-bind-step">
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
        <button className="couple-primary" disabled={busy || withdrawingInvite || !char} onClick={() => bind(false)}>{busy ? '等待回应…' : bond?.status === 'pending' ? '获取邀请回应' : '发送绑定申请'}</button>
        {bond?.status === 'pending' && <button disabled={withdrawingInvite} onClick={() => void withdrawInvite()}>
          {withdrawingInvite ? '正在撤回…' : '撤回绑定邀请'}
        </button>}
        <button disabled={busy || withdrawingInvite || !char} onClick={() => bind(true)}>直接建立羁绊</button>
        <button disabled={busy} onClick={() => setPickerStep('orbit')}><CaretLeft size={17} /> 返回角色星轨</button>
      </section>}
      {!pairs && pickerStep === 'actions' && bond?.status === 'closed' && <section className="couple-card couple-binding-state">
        <h3>空间已关闭</h3>
        <p>你与 {names.them} 的空间记录和积分已保留。重新开启后可以继续使用。</p>
        <button className="couple-primary" disabled={busy} onClick={() => toggleSpace(true)}>重新开启</button>
      </section>}
      {bond?.status === 'open' && char && (!isPair || other) && (isPair || (!pairs && pickerStep === 'space')) && <>
        {!panel && <>

          <section className="couple-ios-hero" aria-label="我们的空间">
            {bond.cover && <TokenImg value={bond.cover} alt="" className="couple-ios-cover" key={bond.cover}
              style={{ objectPosition: `center ${bond.position ?? 50}%`, transform: `scale(${bond.zoom ?? 1})` }}
              onError={event => { event.currentTarget.hidden = true; }} />}
            <div className="couple-ios-topline">
              <span>JUST THE TWO OF US</span><span>{bond.start}</span>
            </div>
            <div className="couple-ios-hero-center">
              <div className="couple-ios-portrait-pair">
                <span className="couple-ios-face couple-ios-face-first"><Avatar person={isPair ? (char ?? { avatar: '', name: names.me }) : userProfile} /></span>
                <span className="couple-ios-face couple-ios-face-second"><Avatar person={other ?? char ?? { avatar: '', name: names.them }} /></span>
              </div>
              <div className="couple-ios-days"><span>{relationship.days}</span><strong>{String(days).padStart(2,'0')}</strong><small>天</small></div>
            </div>
            <div className="couple-ios-hero-bottom">
              <div><strong>{names.me} <span>·</span> {names.them}</strong><small>{relationNames[bond.relation]} · Lv.{bondLevel(bond)} 专属牵绊</small></div>
              {!isPair && <button type="button" onClick={() => setPickerStep('orbit')}>切换角色 <ArrowRight size={13}/></button>}
            </div>
          </section>
          {isPair && <details className="couple-ios-pair-info">
            <summary>他们的关系摘要 <span>展开详情</span></summary>
            <p>亲密度 {bond.pairStats?.intimacy ?? '—'} · 信任 {bond.pairStats?.trust ?? '—'} · 张力 {bond.pairStats?.tension ?? '—'}</p>
            {digest && <p>{digest}</p>}
            <div className="couple-actions">
              <button disabled={busy} onClick={() => void run(async () => {
                const data = await readPairDigest(members);
                setDigest(`共同群聊 ${data.groups.length} 个 · 同场剧情 ${data.scenes.length} 场 · Spark 互动 ${data.posts.length} 条`);
              })}>重新汇整</button>
              <button disabled={busy} onClick={() => void run(async () => {
                const note = window.prompt('想看什么？（可以留空）','');
                if (note === null) return;
                const result = extractJson(await generate(`以旁观者身份为这两位角色写一则故事，贴合关系设定，生成新内容时标明是演绎。补充要求：${note}。仅返回 JSON {"title":"标题","body":"正文","intimacy":0到100,"trust":0到100,"tension":0到100}。`));
                if (typeof result?.title !== 'string' || typeof result?.body !== 'string' || !result.title.trim() || !result.body.trim()) throw new Error('没有收到有效故事');
                const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0,Math.min(100,value))) : 0;
                await change(current => ({ ...current,
                  entries: [...current.entries,createEntry('timeline',result.title,result.body,'them')],
                  pairStats: { intimacy: score(result.intimacy), trust: score(result.trust), tension: score(result.tension) }
                }));
                setPanel('timeline');
              })}>让 AI 写他们的故事</button>
            </div>
          </details>}
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

          <section className="couple-ios-workspace">
            <nav className="couple-ios-tabs" role="tablist" aria-label="情侣空间功能">
              {spaceShelves.map(section => <button key={section.id} type="button" role="tab"
                aria-selected={activeShelf === section.id} aria-controls="couple-ios-current-shelf"
                onClick={() => { setActiveShelf(section.id); setLockedPanel(undefined); }}>
                {section.title}
              </button>)}
            </nav>
            <div id="couple-ios-current-shelf" role="tabpanel" className="couple-ios-shelf" key={shelf.id}>
              <div className="couple-ios-section-title">
                <span>{shelf.english}</span><strong>{shelf.id === 'memory' ? relationship.title : shelf.id === 'care' ? relationship.care : relationship.collection}</strong>
              </div>
              {visibleShelfPanels.length > 0 && <>
                <button className={visibleShelfPanels[0] === 'timeline' ? 'couple-ios-spotlight couple-ios-spotlight-cinema' : visibleShelfPanels[0] === 'wish' ? 'couple-ios-spotlight couple-ios-spotlight-wish' : 'couple-ios-spotlight'} type="button" onClick={() => goToFeature(visibleShelfPanels[0])}>
                  <span className="couple-ios-spotlight-overline">01 / {shelf.english}</span>
                  <span className="couple-ios-spotlight-bottom">
                    <span><strong>{labels[visibleShelfPanels[0]]}</strong>
                      <small>{featureNotes[visibleShelfPanels[0]]}</small></span>
                    <ArrowRight size={20} weight="light"/>
                  </span>
                  <span className="couple-ios-spotlight-count">{featureStatus(visibleShelfPanels[0])}</span>
                </button>
                <div className="couple-ios-links">
                  {visibleShelfPanels.slice(1).map((id,index) => <button type="button" key={id}
                    className="couple-ios-link" onClick={() => goToFeature(id)}>
                    <span className="couple-ios-link-index">{String(index+2).padStart(2,'0')}</span>
                    <span className="couple-ios-link-label"><strong>{labels[id]}</strong><small>{featureNotes[id]}</small></span>
                    <span className="couple-ios-link-trail">{featureStatus(id)} <ArrowRight size={14} weight="light"/></span>
                  </button>)}
                </div>
              </>}
            </div>
          </section>
        </>}
        {panel && panel in recordNames && <BondRecords key={`${key}:${bond.id}:${panel}`} kind={panel as EntryKind} bond={bond}
          names={names} change={change} generate={(instruction, signal) => generate(instruction, bond, undefined, signal)} share={isPair ? undefined : share} busy={busy} notify={addToast}
          avatarMe={isPair ? char?.avatar : userProfile.avatar} avatarThem={(other ?? char)?.avatar}
          charId={!isPair ? char?.id : undefined}
          generateTimeline={(instruction, date) => generate(instruction, bond, date)}
          backHandler={recordBack}
          onNativeJournal={!isPair && char ? () => { setActiveCharacterId(char.id); openApp(AppID.Journal); } : undefined} />}
        {panel === 'shop' && <BondShop bond={bond} partner={names.them} change={change} generate={generate} share={share} busy={busy} notify={addToast} />}
        {panel === 'achievements' && <section className="couple-achievement-hall">
          <div className="couple-achievement-cover">
            <span>THE LITTLE MILESTONES</span>
            <div><strong>{bondAchievements(bond, days).filter(item => item.count >= item.goal).length + (bond.milestones?.length ?? 0)}<small> / {bondAchievements(bond, days).length + (bond.milestones?.length ?? 0)}</small></strong>
            <p>每个小小的里程碑，都是你们一起走过的证明。</p></div>
          </div>
          <details className="couple-record-tools">
            <summary>剧情与家园成就</summary>
            <div className="couple-actions">
              <label>成就来源 <select value={milestoneFilter} onChange={event => setMilestoneFilter(event.target.value)}>
                <option value="all">全部来源</option><option value="story">剧情</option><option value="home">家园</option>
              </select></label>
              <button type="button" disabled={busy} onClick={() => setMilestoneDraft({ id: crypto.randomUUID(), title: '', date: today,
                source: milestoneFilter === 'home' ? 'home' : 'story' })}>记下成就</button>
              <button type="button" disabled={busy} onClick={() => {
                if (milestoneSources) setMilestoneSources(undefined);
                else void run(async () => setMilestoneSources(await loadBondMilestoneSources(members)));
              }}>{milestoneSources ? '收起已有记录' : '从已有记录选取'}</button>
            </div>
            {milestoneSources && <div className="couple-record-tools">
              {!milestoneSources.some(item => milestoneFilter === 'all' || item.source === milestoneFilter) &&
                <p>这个来源暂时没有可选记录。</p>}
              {milestoneSources.filter(item => milestoneFilter === 'all' || item.source === milestoneFilter).map(item => {
                const included = bond.milestones?.some(row => row.id === item.id);
                return <div className="couple-achievement" key={item.id}>
                  <div className="couple-achievement-copy"><strong>{item.title}</strong><small>{item.source === 'home' ? '家园' : '剧情'} · {item.date}</small></div>
                  <div className="couple-actions"><button disabled={busy || included} onClick={() => {
                    setMilestoneDraft(item);
                    setMilestoneSources(undefined);
                  }}>{included ? '已收录' : '选用'}</button></div>
                </div>;
              })}
            </div>}
            {milestoneDraft && <form className="couple-record-tools" onSubmit={event => {
              event.preventDefault();
              const title = milestoneDraft.title.trim();
              if (!title) return;
              void run(async () => {
                const milestone = { ...milestoneDraft, title };
                await change(current => ({ ...current, milestones: [...(current.milestones ?? []).filter(item => item.id !== milestone.id), milestone] }));
                setMilestoneDraft(undefined);
              });
            }}>
              <label>成就名称<input required maxLength={100} value={milestoneDraft.title} onChange={event => setMilestoneDraft({ ...milestoneDraft, title: event.target.value })}/></label>
              <label>记录日期<input required type="date" value={milestoneDraft.date} onChange={event => setMilestoneDraft({ ...milestoneDraft, date: event.target.value })}/></label>
              <label>来源<select value={milestoneDraft.source} onChange={event => setMilestoneDraft({ ...milestoneDraft, source: event.target.value === 'home' ? 'home' : 'story' })}>
                <option value="story">剧情</option><option value="home">家园</option></select></label>
              <div className="couple-actions"><button disabled={busy}>保存成就</button><button type="button" onClick={() => setMilestoneDraft(undefined)}>取消</button></div>
            </form>}
            {(bond.milestones ?? []).filter(item => milestoneFilter === 'all' || item.source === milestoneFilter)
              .sort((a,b) => b.date.localeCompare(a.date)).map(item => <div className="couple-achievement" key={item.id}>
                <div className="couple-achievement-copy"><strong>{item.title}</strong><small>{item.source === 'home' ? '家园' : '剧情'} · {item.date}</small></div>
                <div className="couple-actions"><button disabled={busy} onClick={() => setMilestoneDraft(item)}>编辑</button>
                  <button disabled={busy} onClick={() => {
                    if (window.confirm('删除这条成就？')) void run(() => change(current => ({ ...current,
                      milestones: current.milestones?.filter(row => row.id !== item.id) })));
                  }}>删除</button></div>
              </div>)}
          </details>
        {bondAchievements(bond, days).map((item, index) => <div className="couple-achievement" key={item.title}>
          <div className="couple-achievement-copy">
            <small>{String(index + 1).padStart(2, '0')} / ACHIEVEMENT</small>
            <strong>{item.count >= item.goal ? item.secret ?? item.title : item.title}</strong>
            <small>{item.secret && item.count < item.goal ? '等待发现' : `${Math.min(item.count, item.goal)} / ${item.goal}`}</small>
          </div>
          <span className="couple-achievement-value">{Math.min(item.count, item.goal)} <small>/ {item.goal}</small></span>
          <div className="couple-achievement-track"><span style={{ width: `${Math.min(100, Math.round(item.count / Math.max(1,item.goal) * 100))}%` }} /></div>
        </div>)}
        </section>}
        {panel === 'plant' && <section className="couple-plant-room">
          <div className="couple-plant-header"><span>OUR LITTLE GARDEN</span><strong>一起把春天养大</strong></div>
          <div className={'couple-plant-scene couple-plant-stage-' + plantStageNow}>
            <span className="couple-plant-scene-sun" aria-hidden="true"/>
            <div className="couple-plant-specimen" role="img" aria-label={'植物状态：' + plantStageNow}>
              <span className="couple-plant-specimen-stem"/>
              <span className="couple-plant-specimen-leaf couple-leaf-left"/>
              <span className="couple-plant-specimen-leaf couple-leaf-right"/>
              <span className="couple-plant-specimen-bloom"/>
              <span className="couple-plant-specimen-pot"/>
            </div>
            <span className="couple-plant-scene-caption">GROW WITH YOU</span>
          </div>
          <div className="couple-plant-status">
            <div><span>当前状态</span><strong>{plantStageNow}</strong></div>
            <div><span>成长进度</span><strong>{bond.plant.xp} / 100</strong></div>
          </div>
          <progress max={100} value={bond.plant.xp} />
          {recentWater && <p className="couple-plant-last couple-plant-notice" role="status"
            style={{ animationDelay: `-${Math.min(waterAge, PLANT_WATER_NOTICE_MS - 1)}ms` }}>
            <span aria-hidden="true">✓</span> {names[bond.plant.lastSide!]} 刚刚浇了水
          </p>}
          <div className="couple-actions couple-plant-actions">
            <button disabled={busy || waterWait > 0} onClick={() => void run(async () => {
              await change(current => careForPlant(current, 'water', 'me'));
              setPlantNow(Date.now());
            })}><span>浇水</span>{waterWait > 0 && Number.isFinite(waterWait) && <small>{careWaitLabel(waterWait)}</small>}</button>
            <button disabled={busy || feedWait > 0} onClick={() => void run(async () => {
              await change(current => careForPlant(current, 'fertilize', 'me'));
              setPlantNow(Date.now());
            })}><span>施肥</span>{feedWait > 0 && Number.isFinite(feedWait) && <small>{careWaitLabel(feedWait)}</small>}</button>
            {!isPair && <button disabled={busy || waterWait > 0} onClick={() => void run(async () => {
              const result = extractJson(await generate('对方邀请你照顾两人种的盆栽。按角色决定是否浇水。仅输出 JSON {"water":true或false,"reply":"你的回应"}。'));
              if (typeof result?.water !== 'boolean') throw new Error('没有收到明确答复');
              if (result.water) {
                await change(current => {
                  if (current.plant.cycleId !== bond.plant.cycleId) throw new Error('盆栽已换盆，请重新邀请照料');
                  return careForPlant(current, 'water', 'them');
                });
                setPlantNow(Date.now());
              }
              addToast(typeof result.reply === 'string' ? result.reply : (result.water ? '角色帮你浇水了' : '角色暂时没有浇水'));
            })}>请 {names.them} 照料</button>}
            {plantStageNow === '枯萎' ? <button disabled={busy} onClick={() => void run(() => change(current => {
              if (plantStage(current.plant) !== '枯萎') throw new Error('盆栽已经变化，请重新查看');
              return replantBond(current);
            }))}>重新播种</button> : bond.plant.xp > 0 && <button disabled={busy} onClick={() => {
              if (!window.confirm('丢掉当前这盆花并重新播种？已经收藏的花和礼物会保留。')) return;
              void run(() => change(current => {
                if (current.plant.cycleId !== bond.plant.cycleId || current.plant.watered !== bond.plant.watered)
                  throw new Error('盆栽已经变化，请重新查看');
                return replantBond(current);
              }));
            }}>换盆重种</button>}
            {!!bond.plant.droplets && <button disabled={busy || plantStageNow === '枯萎'} onClick={() => void run(() => change(current => {
              if (plantStage(current.plant) === '枯萎') throw new Error('先重新播种，再收集水滴');
              return collectPlantDroplets(current);
            }))}>收下水滴 · {bond.plant.droplets}</button>}
            {plantStageNow === '开花' && <button disabled={busy} onClick={() => void run(() =>
              change(current => harvestPlant(current, 'me', names.them)))}>收花并送给 {names.them}</button>}
          </div>
          <div className="couple-plant-footnote">
            {plantStageNow === '枯萎' ? '盆栽已枯萎，重新播种后才能继续照料。' :
              `浇水：${careWaitLabel(waterWait)} · 施肥：${careWaitLabel(feedWait)} · 连续 3 天未浇水会枯萎`}
          </div>
          {!!bond.plant.partnerCare && <p className="couple-plant-footnote">{names.them} 已照料这盆花 {bond.plant.partnerCare} 次</p>}
          {!isPair && <label className="couple-plant-auto"><input type="checkbox" checked={!!bond.plantAuto} disabled={busy} onChange={event => {
            const plantAuto = event.target.checked;
            void run(() => change(current => ({ ...current, plantAuto })));
          }} /> 允许角色在私聊后顺手照料盆栽</label>}
          <div className="couple-plant-gallery">
            <div className="couple-plant-gallery-heading"><span>BOTANICAL COLLECTION</span><h3>花朵图鉴</h3></div>
            {bond.flowers?.length ? <div className="couple-plant-flowers">{bond.flowers.map(flower =>
              <article key={flower.id} className="couple-flower-card">
                <span className="couple-flower-mark" aria-hidden="true">✳</span>
                <strong>{flower.name}</strong>
                <small>{flower.date}</small>
                <small>来自 {names[flower.from]}</small>
                {flower.story && <details><summary>花笺</summary><p>{flower.story}</p></details>}
              </article>)}</div>
              : <div className="couple-flower-empty">第一朵花，会被收藏在这里。</div>}
          </div>
        </section>}
        {panel === 'touch' && (char ? <TouchPanel key={key} bond={bond} char={char} apiConfig={apiConfig} busy={busy} run={run} change={change} generate={generate} upload={upload} />
          : <p className="couple-error" role="alert">原绑定角色已不存在，请返回选择仍存在的角色。</p>)}
        {panel === 'settings' && <section className="couple-settings">
          <div className="couple-settings-preview">
            {bond.cover ? <TokenImg value={bond.cover} alt="当前空间封面" /> : <div className="couple-settings-cover-blank"><span>OUR SPACE</span><strong>{names.me} &amp; {names.them}</strong></div>}
            <span>SPACE / CUSTOMIZE</span>
          </div>
          <div className="couple-settings-group-heading"><span>01</span><strong>关系与纪念</strong></div>
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
          <div className="couple-settings-group-heading"><span>02</span><strong>空间封面</strong></div>
          {isPair && <label>合影风格<select disabled={busy} value={pairCoverStyle} onChange={event => {
            const style = pairCoverStyles.find(item => item === event.target.value);
            if (style) setPairCoverStyle(style);
          }}>{pairCoverStyles.map(style => <option key={style}>{style}</option>)}</select></label>}
          <label className="couple-file"><span>选择本地封面</span>
            <input type="file" accept="image/*" disabled={busy} onChange={event => upload(event.target.files?.[0], 'cover')} />
          </label>
          <div className="couple-actions">
            <button disabled={busy} onClick={() => void run(async () => setGallery(gallery ? undefined : (await DB.getGalleryImages()).slice(-48).reverse()))}>
              {gallery ? '关闭相册' : '从相册选封面'}
            </button>
            <button disabled={busy || !char || (isPair && !other)} onClick={() => void run(async () => {
              if (!char) throw new Error('原绑定角色已不存在');
              const style = isPair ? pairCoverStyle : window.prompt('想要什么样的合照？例如日常抓拍、影楼棚拍、电影感。', '日常抓拍');
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
          <div className="couple-settings-group-heading"><span>03</span><strong>空间管理</strong></div>
          <div className="couple-actions">
            <button disabled={busy} onClick={() => { setPanel(undefined); if (isPair) setPair([]); else setPairs(true); }}>{isPair ? '更换配对' : '他们的空间'}</button>
            <button disabled={busy} onClick={() => {
              if (window.confirm('重置当前空间？空间内的记录和积分会清除。')) void run(async () => {
                await persist(members, current => current?.id === bond.id ? undefined : current);
                setPanel(undefined);
                if (isPair) setPair([]);
                else setPickerStep('actions');
              });
            }}>重置空间</button>
          </div>
          {!isPair && <div className="couple-binding-controls">
            {confirmClose ? <div ref={confirmation} role="group" aria-label="确认解除绑定">
              <h3>解除与 {names.them} 的绑定？</h3>
              <p>空间会关闭，记录、积分和私聊历史会保留。</p>
              <div className="couple-actions">
                <button disabled={busy} onClick={() => setConfirmClose(false)}>保留空间</button>
                <button className="couple-binding-danger" disabled={busy} onClick={() => toggleSpace(false)}>确认解除</button>
              </div>
            </div> : <button className="couple-binding-danger" disabled={busy} onClick={() => setConfirmClose(true)}>解除绑定</button>}
          </div>}
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
  const [pendingTouch, setPendingTouch] = useState(false);
  const [calibration, setCalibration] = useState<string>();
  const [voice, setVoice] = useState('');
  const [full, setFull] = useState(false);
  const [portraitSlot, setPortraitSlot] = useState<keyof typeof touchPortraitSlots>('press');
  const [pressed, setPressed] = useState(false);
  const [closePose, setClosePose] = useState(false);
  const [batchSize, setBatchSize] = useState(2);
  const portraitImage = useRef<HTMLImageElement | null>(null);
  const replyRef = useRef<HTMLDivElement | null>(null);
  const portraitRequest = useRef<AbortController>();
  const startPoint = useRef<{ x: number; y: number; rect: DOMRect }>();
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const availableImage = (value: string | undefined) => value && !failedImages.includes(value);
  const portrait = [bond.touchPortraits?.idle, bond.portrait, resolveCompanionPortrait(char),
    listCompanionDateOutfits(char)[0]?.preview, bond.touchPortraits?.press, bond.touchPortraits?.closeIdle,
    bond.touchPortraits?.closePress].find(availableImage);
  const variant = calibration ? undefined : pressed
    ? [closePose ? bond.touchPortraits?.closePress : undefined, bond.touchPortraits?.press].find(availableImage)
    : closePose ? [bond.touchPortraits?.closeIdle].find(availableImage) : undefined;
  const displayImage = variant || portrait || (availableImage(char.avatar) ? char.avatar : undefined);
  useEffect(() => () => portraitRequest.current?.abort(), []);
  useEffect(() => () => { if (voice.startsWith('blob:')) URL.revokeObjectURL(voice); }, [voice]);
  const zones = ['头发', '脸颊', '肩膀', '手'];
  const anchorZones = [...zones, '左眼', '右眼', '鼻尖', '嘴唇', '下巴'];
  useLocalBackHandler(() => {
    if (!full) return false;
    setFull(false);
    return true;
  }, 30);
  const tools = ['手', '羽毛', '冰块', '绳子', '毛笔', '唇', '眼罩', '轻拍'];
  const props = [...tools, ...(bond.touchProps ?? [])];
  const gestures = [["头发","摸摸头","像揉乱一缕发丝"],["脸颊","碰碰脸","靠近一点点"],["肩膀","拍拍肩","轻声回应"],["手","牵一下","把心意放进掌心"]] as const;

  const touch = (bodyPart: string, bringReplyIntoView = false) => run(async () => {
    if (bringReplyIntoView) {
      window.requestAnimationFrame(() => replyRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'nearest',
      }));
    }
    setPendingTouch(true);
    try {
      const key = `${prop}:${bodyPart}`;
      const text = bond.touchLines?.[key] ?? await generate(
        `在专属贴贴里，用户想用「${prop}」轻碰你的「${bodyPart}」。按人设、关系和同意边界给出一到三句当下回应。可以接受、移开或拒绝。`,
      );
      await change(current => reward({
        ...current, touches: current.touches + 1, touchLines: { ...current.touchLines, [key]: text },
      }, `touch:${dayKey()}`, 5));
      setReaction(text);
      setVoice('');
      if (bond.touches >= 3) setClosePose(true);
    } finally {
      setPendingTouch(false);
    }
  });
  return <section className={'couple-touch-room couple-touch-experience' + (full ? ' couple-touch-full' : '')}>
    <div className="couple-touch-intro">
      <div><span aria-hidden="true">♡</span><h2>靠近一点点</h2></div>
      <button type="button" className="couple-touch-focus" aria-pressed={full} onClick={() => setFull(!full)}>
        {full ? '收起画面' : '沉浸画面'}
      </button>
    </div>
    <div className={'couple-touch-stage' + (pressed ? ' couple-touch-stage-pressed' : '')}>
      <span className="couple-touch-stage-glow" aria-hidden="true"/>
      <span className="couple-touch-stage-whisper" aria-hidden="true">✧</span>
      <div className={'couple-portrait couple-touch-frame' + (portrait ? ' couple-portrait-interactive' : displayImage ? ' couple-touch-avatar-only' : '')}>
      {displayImage ? <div className="couple-touch-image"><TokenImg value={displayImage} alt={char.name} draggable={false}
        onLoad={event => { portraitImage.current = event.currentTarget; }}
        onError={() => setFailedImages(current => [...new Set([...current, displayImage])])}
        onPointerDown={event => {
          startPoint.current = { x: event.clientX, y: event.clientY, rect: event.currentTarget.getBoundingClientRect() };
          if (!busy && !calibration && displayImage) {
            event.currentTarget.setPointerCapture(event.pointerId);
            setPressed(true);
          }
        }}
        onPointerCancel={() => { startPoint.current = undefined; setPressed(false); }}
        onLostPointerCapture={() => { startPoint.current = undefined; setPressed(false); }}
        onPointerUp={event => {
          setPressed(false);
          const start = startPoint.current;
          startPoint.current = undefined;
          if (!displayImage || busy || !start || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 12) return;
          const rect = start.rect;
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
        }} />
        {portrait && !calibration && !pressed && displayImage === portrait && anchorZones.filter(part => bond.touchCalibration?.[part]).map(part => {
        const point = bond.touchCalibration![part];
        return <button key={part} type="button" className="couple-hotspot" data-label={part}
          aria-label={`触碰${part}`} title={`触碰${part}`}
          style={{ top: `${point.y}%`, left: `${point.x}%` }} disabled={busy} onClick={() => touch(part)}>{part}</button>;
      })}
      </div> : <div className="couple-portrait-empty">
        <HandHeart size={24} weight="duotone" aria-hidden />
        <span>选一张立绘，或直接使用下方的部位按钮。</span>
      </div>}
    </div>
    
      <div ref={replyRef} className="couple-touch-response" aria-live="polite">
        {pendingTouch ? <>
          <span>{char.name} 正在回应</span>
          <p className="couple-touch-awaiting">TA 正在想怎么回应你的靠近<span aria-hidden="true"> ···</span></p>
        </> : reaction ? <>
          <span>{char.name} 说</span>
          <p>{reaction}</p>
          {voice ? <audio src={voice} controls autoPlay /> : <button type="button" disabled={busy} onClick={() => run(async () => {
            const { synthesizeSpeech } = await import('../utils/ttsRouter');
            setVoice(await synthesizeSpeech(reaction, char, apiConfig));
          })}>听听 TA 的声音 <span aria-hidden="true">▷</span></button>}
        </> : <>
          <span aria-hidden="true">✧</span>
          <p>{displayImage ? '轻触 TA' : '轻触下方按钮'}</p>
        </>}
      </div>
    </div>
    <div className="couple-touch-interaction">
      <div className="couple-touch-interaction-head"><strong>♡</strong><span aria-hidden="true">✧</span></div>
      <div className="couple-touch-gesture-grid" role="group" aria-label="贴贴动作">
        {gestures.map(([part, title, detail]) => <button key={part} type="button" disabled={busy || !!calibration}
          onClick={() => touch(part, true)}>
          <strong>{title}</strong><small>{detail}</small><span aria-hidden="true">↗</span>
        </button>)}
      </div>
      <div className="couple-touch-tool-label"><span>✧</span></div>
      <div className="couple-touch-tools-scroll" role="group" aria-label="互动道具" tabIndex={0}>
        {props.filter((_, index) => index >= tools.length || index <= Math.floor(bond.touches / 4))
          .map(item => <button key={item} type="button" aria-pressed={prop === item}
            disabled={busy} onClick={() => setProp(item)}>{item}</button>)}
      </div>
    </div>
    <details className="couple-touch-customization">
      <summary><span><strong>布置我们的角落</strong><small>立绘、差分、音乐和触碰位置</small></span><span aria-hidden="true">⌄</span></summary>
      <div className="couple-touch-custom-content">
        <div className="couple-actions couple-touch-asset-actions">
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
      <input type="file" accept="image/*" disabled={busy} onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        upload(file, 'portrait');
      }} />
    </label>
    <details className="couple-record-tools">
      <summary>立绘差分与台词</summary>
      <label>立绘状态<select value={portraitSlot} disabled={busy} onChange={event => {
        setPortraitSlot(event.target.value as keyof typeof touchPortraitSlots);
      }}>{Object.entries(touchPortraitSlots).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="couple-file"><span>上传{touchPortraitSlots[portraitSlot]}立绘</span>
        <input type="file" accept="image/*" disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          run(async () => {
            if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) throw new Error('请选择 12 MB 以内的图片');
            const image = await processImage(file, { maxWidth: 1000 });
            await change(current => ({ ...current, touchPortraits: { ...current.touchPortraits, [portraitSlot]: image }, ...(portraitSlot === 'idle' ? { touchCalibration: {} } : {}) }));
          });
        }}/>
      </label>
      <div className="couple-actions">
        <button type="button" disabled={busy} onClick={() => run(async () => {
          const pose = window.prompt('写下差分的姿势和表情', touchPortraitSlots[portraitSlot]);
          if (pose === null) return;
          const controller = new AbortController();
          portraitRequest.current = controller;
          const timer = window.setTimeout(() => controller.abort(), 90_000);
          try {
            const image = await generateBondPortrait(char, `同一角色的互动差分：${touchPortraitSlots[portraitSlot]}，${pose}`, controller.signal);
            if (!controller.signal.aborted) await change(current => ({ ...current, touchPortraits: { ...current.touchPortraits, [portraitSlot]: image }, ...(portraitSlot === 'idle' ? { touchCalibration: {} } : {}) }));
          } finally { clearTimeout(timer); portraitRequest.current = undefined; }
        })}>生成当前差分</button>
        {bond.touchPortraits?.[portraitSlot] && <button type="button" disabled={busy} onClick={() => run(() => change(current => {
          const touchPortraits = { ...current.touchPortraits };
          delete touchPortraits[portraitSlot];
          return { ...current, touchPortraits, ...(portraitSlot === 'idle' ? { touchCalibration: {} } : {}) };
        }))}>移除当前差分</button>}
      </div>
      <label>每批道具数<select value={batchSize} disabled={busy} onChange={event => setBatchSize(Number(event.target.value))}>
        <option value={1}>1 个</option><option value={2}>2 个</option><option value={4}>4 个</option></select></label>
      <div className="couple-actions"><button type="button" disabled={busy} onClick={() => run(async () => {
        const missing = props.filter(tool => zones.some(part => !bond.touchLines?.[`${tool}:${part}`]));
        const batch = missing.slice(0, batchSize);
        if (!batch.length) throw new Error('台词已经齐全，需要替换时可先清空旧台词');
        const keys = batch.flatMap(tool => zones.map(part => `${tool}:${part}`));
        const result = extractJson(await generate(`给这些「道具:部位」组合各写一句符合人设、尊重同意边界的即时回应。仅返回 JSON 对象，原样使用键名：${JSON.stringify(keys)}`));
        const lines = Object.fromEntries(keys.flatMap(key => {
          const line = result?.[key];
          return typeof line === 'string' && line.trim() ? [[key, line.trim().slice(0, 400)]] : [];
        }));
        if (!Object.keys(lines).length) throw new Error('这批没有生成可用台词，请重试');
        await change(current => ({ ...current, touchLines: { ...current.touchLines, ...lines } }));
        setReaction(`收录 ${Object.keys(lines).length} 条台词`);
      })}>生成下一批台词</button></div>
    </details>
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
      <option value="">按立绘位置识别</option>{anchorZones.map(part => <option key={part} value={part}>校准{part}</option>)}
    </select></label>}
    {portrait && <div className="couple-actions"><button type="button" disabled={busy || pressed || closePose} onClick={() => run(async () => {
      const image = portraitImage.current;
      if (!image?.complete || !image.naturalWidth) throw new Error('等立绘加载完成再校准');
      const anchors = await detectBondPortraitAnchors(image);
      await change(current => ({ ...current, touchCalibration: { ...current.touchCalibration, ...anchors } }));
      setCalibration(undefined);
    })}>自动校准面部</button>{closePose && <button type="button" onClick={() => setClosePose(false)}>回到初始立绘</button>}</div>}
    
        <div className="couple-touch-custom-row"><button disabled={busy} onClick={() => {
        const name = window.prompt('自订道具名称')?.trim().slice(0, 35);
        if (!name || tools.includes(name)) return;
        run(() => change(current => ({ ...current, touchProps: [...new Set([...(current.touchProps ?? []), name])] })));
      }}>自订道具</button></div>
        <div className="couple-actions"><button disabled={busy || !Object.keys(bond.touchLines ?? {}).length} onClick={() => {
      run(() => change(current => ({ ...current, touchLines: {} })));
      setReaction('');
    }}>清空已生成台词</button></div>
      </div>
    </details>
  </section>;
}
