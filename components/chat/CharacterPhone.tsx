import {useOS} from '../../context/OSContext';
import PhoneMemo from './PhoneMemo';
import CharacterAvatarLibraryModal from './CharacterAvatarLibraryModal';
import CharacterPhoneSocialApps, {CharacterPhoneSocialIcon} from './CharacterPhoneSocialApps';
import {CharacterPhoneHome,CharacterPhoneLockScreen,CharacterPhoneBeautify,useAppearance,type PhoneHomeTarget} from './CharacterPhoneDesktop';
import {CHARACTER_PHONE_INSTALL_CHANGED, CHARACTER_PHONE_SOCIAL_APPS, CHARACTER_PHONE_SOCIAL_APP_INFO,
  readCharacterPhoneInstallPlan, generateCharacterPhoneInstallPlan, setCharacterPhoneSocialAppInstalled,
  isCharacterPhoneSocialAppId, type CharacterPhoneInstallPlan, type CharacterPhoneSocialAppId,
} from '../../utils/characterPhoneAppInstall';
import { createPortal } from 'react-dom';
import { readCharacterAvatarLibrary } from '../../utils/characterAvatarLibrary';
import { readCharacterPhoneApiSettings, writeCharacterPhoneApiSettings, resolveCharacterPhoneApi } from '../../utils/characterPhoneApiConfig';
import { CHARACTER_PHONE_SELF_CHANGED, readCharacterPhoneSelfProfile, runCharacterPhoneSelfAutonomy } from '../../utils/characterPhoneSelfProfile';
import {considerCharacterMemo} from '../../utils/characterMemoAutonomy';
import Gallery from '../../apps/Gallery';
import { refreshNpcMoments } from '../../utils/refreshNpcMoments';
import PhoneStatusBar from './PhoneStatusBar';
import CharacterPhoneWallet from './CharacterPhoneWallet';
import CharacterPhoneBrowser from './CharacterPhoneBrowser';
import PhoneAvatar from './PhoneAvatar';
import PullToRefresh from './PullToRefresh';
import PhoneChatBubbles from './PhoneChatBubbles';
import { MomentsTimeline } from './MomentsTimeline';
import { CHARACTER_MOMENTS_CHANGED, readCharacterMoments, publishCharacterMoment, deleteCharacterMoment, addMomentComment, type CharacterMoment } from '../../utils/characterPhoneMoments';
import { PENDING_PHONE_CONTACTS_CHANGED, readPendingContacts, writePendingContacts, type PendingPhoneContact } from '../../utils/characterPhoneRequests';
import { DB } from '../../utils/db';
import { ChatPrompts } from '../../utils/chatPrompts';
import { ContextBuilder } from '../../utils/context';
import { resolveCharTimeZone } from '../../utils/timezone';
import { mirrorPrivateChat } from '../../utils/characterPhonePrivateSync';
import {HOME_HISTORY_COMMITTED} from '../../utils/secretNote';
import type { PhoneThreadV2 } from '../../utils/characterPhoneModel';
import { buildCharacterPhoneContext } from '../../utils/characterPhoneContext';
import type { UserProfile, GroupProfile, RealtimeConfig, VisionApiConfig } from '../../types';
import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChatCircleDots, GearSix, Wallet, UsersThree, Images, Phone, NotePencil, ChatText, Globe, House, MagnifyingGlass, Plus, Compass, User, ChatsCircle, SpinnerGap, CreditCard, Megaphone, BookOpen } from '@phosphor-icons/react';
import { getDailyScheduleForChar } from '../../utils/dailySchedule';
import {
  CHARACTER_PHONE_CHATS_CHANGED, readCharacterPhoneChats,
  updateCharacterPhoneChats, deleteCharacterPhoneChat, erasePhoneWechatRelationshipNotes, notifyCharacterPhoneChatsChanged,
  type CharacterPhoneChat,
} from '../../utils/characterPhoneChats';
import { findKnownNpc, registerDiscoveredNpc, noteNpcInteraction } from '../../utils/characterNpcNetwork';
import { isCharacterPhoneAutonomyEnabled, setCharacterPhoneAutonomyEnabled } from '../../utils/characterPhoneAutonomy';
import {
  CHARACTER_PHONE_API_SETTINGS_CHANGED, CHARACTER_PHONE_API_BUDGET_CHANGED,
  readPhoneAutonomyPreferences, readPhoneApiBudget, writePhoneAutonomyPreferences,
  canUsePhoneApiBudget, reservePhoneApiBudget,
} from '../../utils/characterPhoneApiBudget';
import { beginCharacterPhoneRefresh, finishCharacterPhoneRefresh, isCharacterPhoneRefreshing, CHARACTER_PHONE_REFRESH_CHANGED } from '../../utils/characterPhoneRefreshTracker';
import { getCurrentScheduleSlotIndex } from '../../utils/scheduleTime';
import type { CharacterProfile, DailySchedule } from '../../types';
import { parseGeneratedPhoneMessages, type PhoneMessage } from '../../utils/characterPhoneIdentity';
import { extractContent } from '../../utils/safeApi';
import { fetchCharacterPhoneJson, canRunAutomaticPhoneAi } from '../../utils/characterPhoneAiRequest';
import { CHARACTER_LIFE_EVENTS_CHANGED, readCharacterLifeEvents, pruneOrphanedPhoneChatLifeEvents, recordCharacterLifeEvent, type CharacterLifeEvent } from '../../utils/characterLifeEvents';
import { generateIndependentLifeGlimpse, isManualLifeGlimpseEnabled, setManualLifeGlimpseEnabled } from '../../utils/characterLifeGlimpseGeneration';
import { selectConfirmedLifeGlimpses } from '../../utils/characterLifeGlimpses';
import { readPhoneContentClearRevision } from '../../utils/characterPhoneContentClearRevision';
import { safelySelectCloudPhoneOpportunity } from '../../utils/amsgCloudPhoneSelection';
import { CHARACTER_PHONE_CONTACT_CHANGED, readNpcProfiles, saveNpcProfiles, type NpcProfile } from '../../utils/characterPhoneNpcs';
import {readPhoneInboxPreferences,writePhoneInboxPreferences} from '../../utils/characterPhoneInboxPrefs';
import {allowMomentComment} from '../../utils/momentInteractionPreferences';
import {readMomentInteractionPreferences,writeMomentInteractionPreferences} from '../../utils/momentInteractionPreferences';
import {appendSimulatedPhonePayments} from '../../utils/characterPhonePayments';
import {syncCharacterPhoneWalletPayments} from '../../utils/characterPhoneWallet';
import CharacterPhoneClearManager from './CharacterPhoneClearManager';

type Tab = 'chats' | 'contacts' | 'discover' | 'me';
type Screen = 'home' | 'wechat' | 'thread' | 'contact-detail' | 'moments' | 'wallet' | 'settings' | 'memo' | 'gallery' | 'calls' | 'sms' | 'browser' | 'profile' | 'beautify' | CharacterPhoneSocialAppId;
type ChatRecord = CharacterPhoneChat;
type Api = { baseUrl: string; apiKey: string; model: string; visionApi?: VisionApiConfig };

const timeLabel = (time: number) => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
function PhoneSettingsGroup({title,searching,children}:{
  title:string;searching:boolean;children:React.ReactNode;
}){
  return <details open={searching||undefined}
    className="group overflow-hidden rounded-2xl border border-[#e9e9e9] bg-white">
    <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#333] [&::-webkit-details-marker]:hidden">
      <span>{title}</span>
      <span aria-hidden="true" className="text-lg font-normal text-[#888] transition-transform duration-200 group-open:rotate-180">⌄</span>
    </summary>
    <div className="border-t border-[#eee] p-3">{children}</div>
  </details>;
}
export default function CharacterPhone({
  name, characterId, persona, api, onClose, char, userProfile, groups, realtimeConfig, onApplyAvatar, onPoke,
}: {
  name:string; characterId:string; persona:string; api:Api; onClose:()=>void;
  char:CharacterProfile; userProfile:UserProfile; groups:GroupProfile[];
  realtimeConfig?:RealtimeConfig;
  onApplyAvatar:(image:string)=>Promise<void>;
  onPoke:(suffix:string)=>void;
}) {
  const {apiPresets} = useOS();
  const [phoneApiSettings,setPhoneApiSettings] = useState(()=>readCharacterPhoneApiSettings(characterId));
  useEffect(()=>{setPhoneApiSettings(readCharacterPhoneApiSettings(characterId));},[characterId]);
  const phoneApi=resolveCharacterPhoneApi(characterId,api);
  const changePhoneApiSettings=(updates:Partial<typeof phoneApiSettings>)=>{
    try {setPhoneApiSettings(writeCharacterPhoneApiSettings(characterId,updates));}
    catch {setError('查手机独立 API 保存失败');}
  };

  // Optional apps are chosen once per Char, never synthesized on every open.
  const [installPlan,setInstallPlan] = useState<CharacterPhoneInstallPlan|null>(()=>readCharacterPhoneInstallPlan(characterId));
  const [installBusy,setInstallBusy]=useState(false);
  const [installNotice,setInstallNotice]=useState('');
  const attemptedInstall=useRef('');
  const runPhoneInstall=async(force=false)=>{
    if(installBusy)return;
    setInstallBusy(true);setInstallNotice('');
    try{
      const next=await generateCharacterPhoneInstallPlan({
        char,user:userProfile,groups,realtimeConfig,api:phoneApi,
      },force);
      setInstallPlan(next);
    }catch(e){setInstallNotice(e instanceof Error?e.message:'角色安装分析失败');}
    finally{setInstallBusy(false);}
  };
  useEffect(()=>{
    setInstallPlan(readCharacterPhoneInstallPlan(characterId));
    const onChange=(event:Event)=>{
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)
        setInstallPlan(readCharacterPhoneInstallPlan(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_INSTALL_CHANGED,onChange);
    if(attemptedInstall.current!==characterId){
      attemptedInstall.current=characterId;
      // AI app-install analysis is deliberately deferred until lockscreen entry.
    }
    return()=>window.removeEventListener(CHARACTER_PHONE_INSTALL_CHANGED,onChange);
  },[characterId]);
  const changeSocialAppInstalled=(appId:CharacterPhoneSocialAppId,installed:boolean)=>{
    try{setInstallPlan(setCharacterPhoneSocialAppInstalled(characterId,appId,installed));}
    catch{setError('安装清单保存失败');}
  };
  const [avatarRevision, setAvatarRevision] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ characterId: string }>).detail?.characterId === characterId) setAvatarRevision(v => v + 1);
    };
    window.addEventListener('sully:character-avatar-changed', refresh);
    return () => window.removeEventListener('sully:character-avatar-changed', refresh);
  }, [characterId]);
  const phoneAvatar = React.useMemo(() => {
    const lib = readCharacterAvatarLibrary(characterId);
    return lib.entries.find(entry => entry.id === lib.activeId)?.image || char.avatar;
  }, [characterId, char.avatar, avatarRevision]);
  const [screen, setScreen] = useState<Screen>('home');
  const [phoneUnlocked,setPhoneUnlocked] = useState(false);
  const phoneAppearance=useAppearance(characterId);
  const settingsOrigin=useRef<'home'|'wechat'>('wechat');
  const profileOrigin=useRef<'home'|'wechat'>('wechat');
  useEffect(()=>{setPhoneUnlocked(false);setScreen('home');},[characterId]);
  const unlockPhone=()=>{
    setPhoneUnlocked(true);
    if(!readCharacterPhoneInstallPlan(characterId))void runPhoneInstall();
  };
  const openHomeApp=(id:PhoneHomeTarget)=>{
    if(id==='settings')settingsOrigin.current='home';
    if(id==='profile')profileOrigin.current='home';
    setScreen(id);
    if(id==='wechat')setTab('chats');
  };
  const [avatarLibraryOpen,setAvatarLibraryOpen] = useState(false);
  const [selfAutoBusy,setSelfAutoBusy] = useState(false);
  const [selfAutoNotice,setSelfAutoNotice] = useState('');
  const [selfProfile,setSelfProfile] = useState(() => readCharacterPhoneSelfProfile(characterId));
  useEffect(() => {
    setSelfProfile(readCharacterPhoneSelfProfile(characterId));
    const sync=(event:Event) => {
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)
        setSelfProfile(readCharacterPhoneSelfProfile(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_SELF_CHANGED,sync);
    return()=>window.removeEventListener(CHARACTER_PHONE_SELF_CHANGED,sync);
  },[characterId]);
  const adjustSelfProfile = async () => {
    if(selfAutoBusy)return;
    setSelfAutoBusy(true);setSelfAutoNotice('');
    try {
      const status=await runCharacterPhoneSelfAutonomy(char,phoneApi,onApplyAvatar,true);
      setSelfAutoNotice(status==='changed'?'Char 已根据自己的状态更新个人资料':
        status==='skipped'?'Char 觉得现在不用改变资料':'本次调整失败，请检查聊天 API');
    } catch(e) {setSelfAutoNotice(e instanceof Error?e.message:'本次调整失败');}
    finally{setSelfAutoBusy(false);}
  };
  const [npcAutonomyEnabled, setNpcAutonomyEnabled] = useState(() => isCharacterPhoneAutonomyEnabled(characterId));
  useEffect(() => setNpcAutonomyEnabled(isCharacterPhoneAutonomyEnabled(characterId)), [characterId]);
  const [phonePrefs,setPhonePrefs]=useState(()=>readPhoneAutonomyPreferences(characterId));
  const [momentPrefs,setMomentPrefs]=useState(()=>readMomentInteractionPreferences(characterId));
  useEffect(()=>setMomentPrefs(readMomentInteractionPreferences(characterId)),[characterId]);
  const changeMomentPrefs=(updates:Partial<typeof momentPrefs>)=>{
    try{setMomentPrefs(writeMomentInteractionPreferences(characterId,updates));}
    catch{setError('朋友圈评论设置保存失败');}
  };
  const [inboxPrefs,setInboxPrefs]=useState(()=>readPhoneInboxPreferences(characterId));
  useEffect(()=>setInboxPrefs(readPhoneInboxPreferences(characterId)),[characterId]);
  const updateInboxPrefs=(patch:Partial<typeof inboxPrefs>)=>{
    try{setInboxPrefs(writePhoneInboxPreferences(characterId,patch));}
    catch{setError('微信生成设置保存失败');}
  };
  const [budgetInfo,setBudgetInfo]=useState(()=>readPhoneApiBudget(characterId));
  useEffect(()=>{
    const refresh=()=>{
      setPhonePrefs(readPhoneAutonomyPreferences(characterId));
      setBudgetInfo(readPhoneApiBudget(characterId));
    };
    refresh();
    const onChange=(event:Event)=>{
      if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)refresh();
    };
    window.addEventListener(CHARACTER_PHONE_API_SETTINGS_CHANGED,onChange);
    window.addEventListener(CHARACTER_PHONE_API_BUDGET_CHANGED,onChange);
    return()=>{
      window.removeEventListener(CHARACTER_PHONE_API_SETTINGS_CHANGED,onChange);
      window.removeEventListener(CHARACTER_PHONE_API_BUDGET_CHANGED,onChange);
    };
  },[characterId]);
  const changePhonePrefs=(updates:Partial<typeof phonePrefs>)=>{
    try {
      const next=writePhoneAutonomyPreferences(characterId,updates);
      setPhonePrefs(next);
      setBudgetInfo(readPhoneApiBudget(characterId));
    }catch{setError('自主生活设置保存失败');}
  };
  const [settingsQuery,setSettingsQuery]=useState('');
  const [settingsView,setSettingsView]=useState<'common'|'advanced'>('common');
  const showPhoneSettings=(category:'common'|'advanced',names:string)=>
    (!!settingsQuery.trim() || settingsView===category) && settingsMatch(names);
  const settingsMatch=(names:string)=>!settingsQuery.trim()||
    names.toLocaleLowerCase().includes(settingsQuery.trim().toLocaleLowerCase());
  const [tab, setTab] = useState<Tab>('chats');
  const [wechatSearchOpen,setWechatSearchOpen]=useState(false);
  const [wechatNotice,setWechatNotice]=useState('');
  const [wechatQuery,setWechatQuery]=useState('');
  const [thread, setThread] = useState('');
  const [privateThread, setPrivateThread] = useState<PhoneThreadV2 | null>(null);
  const [swipedId, setSwipedId] = useState('');
  const [touchX, setTouchX] = useState<number | null>(null);
  const [hiddenPrivate, setHiddenPrivate] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => { try { const messages = await DB.getMessagesByCharId(characterId, true); if(active) setPrivateThread(mirrorPrivateChat(characterId, messages)); } catch { /* private chat stays authoritative; never synthesize it */ } };
    void refresh();
    const onHomeClear=(event:Event)=>{
      const detail=(event as CustomEvent<{charId?:string;cleared?:boolean}>).detail;
      if(detail?.cleared&&detail.charId===characterId)void refresh();
    };
    window.addEventListener(HOME_HISTORY_COMMITTED,onHomeClear);
    const timer = window.setInterval(refresh, 30_000);
    return () => { active=false;window.clearInterval(timer);window.removeEventListener(HOME_HISTORY_COMMITTED,onHomeClear); };
  }, [characterId, char, userProfile, groups, realtimeConfig]);
  useEffect(() => { try {setHiddenPrivate(localStorage.getItem('sully_phone_hide_private:'+characterId)==='1');} catch {} },[characterId]);
  const [contactId, setContactId] = useState('');
  const [editing, setEditing] = useState(false);
  const [refreshingContacts, setRefreshingContacts] = useState(false);
  const [batchCount, setBatchCount] = useState(4);
  const [addingContact, setAddingContact] = useState(false);
  const [pendingContacts, setPendingContacts] = useState<PendingPhoneContact[]>(() => readPendingContacts(characterId));
  const [realNameDraft, setRealNameDraft] = useState('');
  useEffect(() => {
    setPendingContacts(readPendingContacts(characterId));
    const onChange = (event: Event) => {if ((event as CustomEvent<{characterId:string}>).detail?.characterId === characterId) setPendingContacts(readPendingContacts(characterId));};
    window.addEventListener(PENDING_PHONE_CONTACTS_CHANGED,onChange);
    return () => window.removeEventListener(PENDING_PHONE_CONTACTS_CHANGED,onChange);
  },[characterId]);
  const [draft, setDraft] = useState({ name:'', identity:'', personality:'', relationship:'', background:'' });
  const [profiles, setProfiles] = useState<NpcProfile[]>(() => readNpcProfiles(characterId));
  const [lifeEvents, setLifeEvents] = useState<CharacterLifeEvent[]>([]); // hydrate after legacy orphan reconciliation; deleted text must not flash
  const [manualGlimpseEnabled, setManualGlimpseEnabled] = useState(() => isManualLifeGlimpseEnabled(characterId));
  const [glimpseGeneratingId, setGlimpseGeneratingId] = useState<string | null>(null);
  const [glimpseNotice, setGlimpseNotice] = useState('');
  const glimpseAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setManualGlimpseEnabled(isManualLifeGlimpseEnabled(characterId));
    setGlimpseGeneratingId(null);
    setGlimpseNotice('');
    return () => { glimpseAbortRef.current?.abort(); glimpseAbortRef.current = null; };
  }, [characterId]);
  const toggleManualGlimpse = (enabled: boolean) => {
    if (!enabled) {
      glimpseAbortRef.current?.abort();
      glimpseAbortRef.current = null;
      setGlimpseGeneratingId(null);
    }
    setManualLifeGlimpseEnabled(characterId, enabled);
    setManualGlimpseEnabled(enabled);
    setGlimpseNotice('');
  };
  const expandLifeGlimpse = async (event: CharacterLifeEvent) => {
    if (!manualGlimpseEnabled || glimpseAbortRef.current || !isManualLifeGlimpseEnabled(characterId)) return;
    const controller = new AbortController();
    glimpseAbortRef.current = controller;
    setGlimpseGeneratingId(event.id);
    setGlimpseNotice('');
    try {
      const outcome = await generateIndependentLifeGlimpse({ char, event, api: phoneApi, signal: controller.signal });
      if (!controller.signal.aborted) setGlimpseNotice(outcome === 'saved' ? '已写入原生活事件的独立描述。' : '本次没有合适的内容，原记录保持不变。');
    } catch (error) {
      if (!controller.signal.aborted) setGlimpseNotice(error instanceof Error ? error.message : '本次生成失败，原生活记录未修改');
    } finally {
      if (glimpseAbortRef.current === controller) {
        glimpseAbortRef.current = null;
        setGlimpseGeneratingId(null);
      }
    }
  };
  const [moments, setMoments] = useState<CharacterMoment[]>(() => readCharacterMoments(characterId));
  const [momentBusy, setMomentBusy] = useState(false);
  const [wechatSuiteBusy,setWechatSuiteBusy]=useState(false);
  const [wechatSuiteNotice,setWechatSuiteNotice]=useState('');
  const [memoBusy,setMemoBusy]=useState(false);
  const [chatComposer,setChatComposer]=useState('');
  const [npcMomentLoading,setNpcMomentLoading]=useState(false);
  const [sharedMomentsRefreshing,setSharedMomentsRefreshing]=useState(() =>
    isCharacterPhoneRefreshing(characterId, 'moments'));
  useEffect(() => {
    setSharedMomentsRefreshing(isCharacterPhoneRefreshing(characterId, 'moments'));
    const handler=(event: Event) => {
      const d=(event as CustomEvent<{characterId:string;feature:string;running:boolean}>).detail;
      if(d?.characterId===characterId && d.feature==='moments')
        setSharedMomentsRefreshing(d.running);
    };
    window.addEventListener(CHARACTER_PHONE_REFRESH_CHANGED,handler);
    return()=>window.removeEventListener(CHARACTER_PHONE_REFRESH_CHANGED,handler);
  },[characterId]);
  const npcPullStart=useRef<number|null>(null);
  useEffect(() => {setMoments(readCharacterMoments(characterId)); const sync=(event:Event)=>{if((event as CustomEvent<{characterId:string}>).detail?.characterId===characterId)setMoments(readCharacterMoments(characterId));};window.addEventListener(CHARACTER_MOMENTS_CHANGED,sync);return ()=>window.removeEventListener(CHARACTER_MOMENTS_CHANGED,sync);},[characterId]);
  useEffect(() => {
    // One-time legacy reconciliation on phone entry: an older build only
    // deleted the WeChat row, leaving its derived life facts and NPC notes.
    // Never infer an orphan from the summary text or touch real User chat.
    const currentThreads=readCharacterPhoneChats(characterId);
    const deletedFacts=pruneOrphanedPhoneChatLifeEvents(characterId,currentThreads.map(t=>t.id));
    const validContactIds=new Set(currentThreads.map(t=>t.contactId).filter(Boolean));
    const orphanContacts=readNpcProfiles(characterId)
      .filter(n=>!validContactIds.has(n.id)&&n.relationshipNotes?.includes('微信提及]'))
      .map(n=>n.id);
    if(orphanContacts.length) {
      try {erasePhoneWechatRelationshipNotes(characterId,orphanContacts);}catch { /* keep chat view available */ }
      if(!deletedFacts)window.dispatchEvent(new CustomEvent(CHARACTER_LIFE_EVENTS_CHANGED,
        {detail:{characterId,pruned:true,orphaned:true}}));
    }
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
  const [schedule, setSchedule] = useState<DailySchedule | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => { getDailyScheduleForChar(char).then(v=>{if(live)setSchedule(v);}).catch(()=>{if(live)setSchedule(null);}); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [char.id, char.customTimezone, char.customTimezoneEnabled]);
  const [busy, setBusy] = useState(false);
  const [sharedWechatRefreshing, setSharedWechatRefreshing] = useState(() => isCharacterPhoneRefreshing(characterId));
  useEffect(() => {
    setSharedWechatRefreshing(isCharacterPhoneRefreshing(characterId));
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ characterId: string; feature: string; running: boolean }>).detail;
      if (detail?.characterId === characterId && detail.feature === 'wechat')
        setSharedWechatRefreshing(detail.running);
    };
    window.addEventListener(CHARACTER_PHONE_REFRESH_CHANGED, handler);
    return () => window.removeEventListener(CHARACTER_PHONE_REFRESH_CHANGED, handler);
  }, [characterId]);

  const [error, setError] = useState('');
  const storageKey = 'sully_character_phone_wechat_v1:' + characterId;
  const [records, setRecords] = useState<ChatRecord[]>(() => readCharacterPhoneChats(characterId));
  useEffect(() => {
    setRecords(readCharacterPhoneChats(characterId));
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{characterId: string}>).detail?.characterId === characterId)
        setRecords(readCharacterPhoneChats(characterId));
    };
    window.addEventListener(CHARACTER_PHONE_CHATS_CHANGED, onChange);
    return () => window.removeEventListener(CHARACTER_PHONE_CHATS_CHANGED, onChange);
  }, [characterId]);
  const persistProfiles = (next: NpcProfile[]): boolean => {
    try { saveNpcProfiles(characterId, next); setProfiles(next); return true; }
    catch { setError('联系人档案保存失败'); return false; }
  };
  const persist = (next: ChatRecord[]): boolean => {
    try { updateCharacterPhoneChats(characterId, () => next); setRecords(next); return true; }
    catch { setError('存储空间不足，记录未能保存'); return false; }
  };
  const back = () => { if (screen === 'contact-detail') { setScreen('wechat'); setTab('contacts'); setEditing(false); return; } if (screen === 'memo' || screen === 'gallery' || screen === 'calls' || screen === 'sms' || screen === 'browser' || screen === 'beautify') setScreen('home'); else if(screen==='profile'){setScreen(profileOrigin.current==='home'?'home':'wechat');setTab('me');} else if(screen==='settings'){setScreen(settingsOrigin.current==='home'?'home':'wechat');} else if (screen === 'thread' || screen === 'moments' || screen === 'wallet') setScreen('wechat'); else if (screen === 'wechat') setScreen('home'); else onClose(); };
  const fullPersona = [persona, char.worldview || '', ...(char.mountedWorldbooks || []).filter(w => (w as typeof w & { enabled?: boolean }).enabled !== false).map(w => w.title + '：' + w.content)].filter(Boolean).join('\n\n').slice(0, 24000);
  const currentSlot = schedule?.slots[getCurrentScheduleSlotIndex(schedule.slots, char)] || null;
  const scheduleContext = currentSlot ? `角色此刻的既有日程：${currentSlot.startTime} ${currentSlot.activity}；${currentSlot.description || ''}；地点：${currentSlot.location || '未设定'}。这只是当前生活状态，不等于必然在玩手机；不可凭空断言已发生社交行为。` : '目前没有可用的角色当日日程，不得编造当前行程。';
  const generateMemo=async()=>{if(memoBusy)return;setMemoBusy(true);setError('');try{if(!phoneApi.apiKey||!phoneApi.baseUrl||!phoneApi.model)throw new Error('请先配置聊天 API');const context=await loadRealContext();await considerCharacterMemo({characterId,name,chatContext:context.systemPrompt,persona:[char.description,char.systemPrompt].filter(Boolean).join('\n'),userName:userProfile.name,api:phoneApi,events:readCharacterLifeEvents(characterId),manual:true});}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setMemoBusy(false);}};
  const loadRealContext = () => buildCharacterPhoneContext(char, userProfile, groups, realtimeConfig);
  const createProfile = async () => {
    if (busy) return;
    if (!phoneApi.apiKey || !phoneApi.baseUrl || !phoneApi.model) { setError('请先配置聊天 API'); return; }
    setBusy(true); setRefreshingContacts(true); setError('');
    try {
      const realContext = await loadRealContext();
      const { response, json } = await fetchCharacterPhoneJson(phoneApi.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + phoneApi.apiKey },
        body: JSON.stringify({ model: phoneApi.model, stream: false, messages: [
          { role: 'system', content: `私聊原版上下文：${realContext.systemPrompt.slice(0, 14000)}。现在生成手机联系人资料，不要直接回复User。手机主人Char的唯一ID是${characterId}，显示名${name}。角色人设：${fullPersona}。${scheduleContext}优先从角色设定与世界书里提到的人物创建联系人；如果没有明确姓名，可以根据世界观、身份、地点和生活圈生成合理的新NPC，但绝不编造与原设定冲突的亲密关系。不得把User或手机主人当成NPC。已有联系人（不要重复身份）：${profiles.map(p => p.name+'('+p.relationship+')').join('、')}。User与Char与NPC身份不同；同名或水仙不能视为同一人。一次生成${batchCount}个不同生活领域的联系人，允许亲友、同事、同学、普通熟人、事务性联系人，不能全是亲密朋友。只返回JSON对象：{"contacts":[{"name":"","identity":"","personality":"","relationship":"","background":""}]}。` },
          { role: 'user', content: '综合角色设定和世界书批量生成${batchCount}份不同且具体的联系人档案。优先已有设定人物；无明确人物时可以创建符合生活圈的普通NPC。不要生成聊天消息。' }
        ] })
      }, { charId: characterId, purpose: '手动生成微信联系人', automatic: false });
      if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
      const data = JSON.parse(extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (typeof data?.error === 'string') throw new Error(data.error);
      const candidates: unknown[] = Array.isArray(data?.contacts) ? data.contacts : (data?.name ? [data] : []);
      const valid = candidates.filter((v): v is Record<string,string> => !!v && typeof v === 'object' && ['name','identity','personality','relationship','background'].every(k=>typeof (v as Record<string,unknown>)[k] === 'string' && !!(v as Record<string,string>)[k].trim())).slice(0,batchCount);
      if (!valid.length) throw new Error('没有生成有效联系人档案，本次未保存');
      const nextProfiles: NpcProfile[] = valid.map(v=>({ id: crypto.randomUUID(), name:v.name.trim().slice(0,40), identity:v.identity.slice(0,240), personality:v.personality.slice(0,700), relationship:v.relationship.slice(0,400), background:v.background.slice(0,900), source:'generated' as const, createdAt:Date.now() }));
      if (!persistProfiles([...profiles,...nextProfiles])) return;
      for (const profile of nextProfiles) recordCharacterLifeEvent({id:'contact:'+profile.id,characterId,kind:'contact-added',occurredAt:profile.createdAt,source:'phone',summary:'新增联系人：'+profile.name,contactId:profile.id});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setRefreshingContacts(false); }
  };
  const acceptRequest = (request: PendingPhoneContact) => {
    if (!profiles.some(p=>p.id===request.id) &&
        !persistProfiles([...profiles,{id:request.id,name:request.nickname,nickname:request.nickname,realName:request.realName,identity:request.identity,personality:request.personality,relationship:request.relationship,background:request.background,source:request.source,createdAt:request.createdAt,linkedCharacterId:request.linkedCharacterId}])) return;
    const next = pendingContacts.filter(p=>p.id!==request.id);
    try { writePendingContacts(characterId,next); setPendingContacts(next); }
    catch { setError('联系人请求保存失败'); }
  };
  const dismissRequest = (id: string) => {const next=pendingContacts.filter(p=>p.id!==id);writePendingContacts(characterId,next);setPendingContacts(next);};
  const addManualContact = () => {
    if (!draft.name.trim() || !draft.identity.trim() || !draft.personality.trim() || !draft.relationship.trim()) { setError('请填写姓名、身份、性格及关系'); return; }
    const profile: NpcProfile = { id: crypto.randomUUID(), name: draft.name.trim(), nickname: draft.name.trim(), realName: realNameDraft.trim(), identity: draft.identity.trim(), personality: draft.personality.trim(), relationship: draft.relationship.trim(), background: draft.background.trim(), source: 'generated', createdAt: Date.now() };
    if (!persistProfiles([...profiles, profile])) return;
    recordCharacterLifeEvent({ id: 'contact:' + profile.id, characterId, kind: 'contact-added', occurredAt: profile.createdAt, source: 'phone', summary: '添加联系人：' + profile.name, contactId: profile.id });
    setAddingContact(false); setError(''); openContact(profile);
  };
  // Inbox generation is independent of the contacts list. A single call yields several threads.
  const generateInbox = async (automatic = false, fullSuite = false) => {
    const prefs=readPhoneInboxPreferences(characterId);
    if (!automatic && (!phoneApi.apiKey||!phoneApi.baseUrl||!phoneApi.model)){
      setError('微信生成需要聊天 API，请先在微信 → 我 → 设置中检查查手机独立 API 或默认聊天 API');
      return;
    }
    if (busy || !phoneApi.apiKey || !phoneApi.baseUrl || !phoneApi.model ||
        (automatic && (!isCharacterPhoneAutonomyEnabled(characterId) ||
            !canUsePhoneApiBudget(characterId) ||
            !canRunAutomaticPhoneAi(characterId, phoneApi.baseUrl.replace(/\/+$/, '') + '/chat/completions'))) ||
        !beginCharacterPhoneRefresh(characterId)) return;
    setBusy(true); setError('');setWechatNotice('');
    const chatsRevisionAtStart=readPhoneContentClearRevision(characterId,'chats');
    const contactsRevisionAtStart=readPhoneContentClearRevision(characterId,'contacts');
    const momentsRevisionAtStart=readPhoneContentClearRevision(characterId,'moments');
    const paymentsRevisionAtStart=readPhoneContentClearRevision(characterId,'payments');
    try {
      const context = await loadRealContext();
      const phoneTimeAwarenessOn = char.timeAwarenessEnabled !== false;
      const phoneTimeZone = resolveCharTimeZone(char);
      // The shared prompt places its volatile clock after the stable persona/worldbook prefix.
      // Preserve that clock explicitly when the long prompt is shortened for the phone API.
      const timeBlockMatch = context.systemPrompt.match(/### 当前时间 \(Now\)\n[\s\S]*?(?=\n\n|$)/);
      const phoneTimeBlock = phoneTimeAwarenessOn
        ? ContextBuilder.buildTimeAwarenessBlock(char).trim()
        : '';
      const contextWithoutTime = timeBlockMatch
        ? context.systemPrompt.replace(timeBlockMatch[0], '')
        : context.systemPrompt;
      const systemContext = contextWithoutTime.length > 36000
        ? `${contextWithoutTime.slice(0, 30000)}\n[中间上下文因长度限制省略]\n${contextWithoutTime.slice(-6000)}`
        : contextWithoutTime;
      const formatPhoneTimestamp = (value: unknown) =>
        phoneTimeAwarenessOn && typeof value === 'number' && Number.isFinite(value)
          ? ChatPrompts.formatDate(value, phoneTimeZone)
          : undefined;
      const existing = readCharacterPhoneChats(characterId).map(r => {
        const lastMessageAt = formatPhoneTimestamp(r.time);
        return {
          id: r.contactId || r.id,
          name: r.name,
          ...(lastMessageAt ? { lastMessageAt } : {}),
          recent: r.messages.slice(-6).map(m => {
            const at = formatPhoneTimestamp(m.createdAt);
            return { ...(at ? { at } : {}), role: m.speaker?.role, text: m.text };
          }),
        };
      });
      const phoneTimeGuidance = phoneTimeAwarenessOn
        ? `【本次手机生成的角色本地时钟】\n${phoneTimeBlock || '角色本地当前时间不可用，不要猜测具体日期或时刻。'}\n以这里的日期、星期、时刻和时区为准。生成前先结合已有消息时间、日程计划和已发生的生活经历选择话题；优先延续未完对话，不要按固定循环随机换联系人/话题、重复寒暄或编造刚发生的事。日程只是计划，不能写成已经发生的事实；没有自然契机时可以少生成或返回空列表。`
        : '【时间感知已关闭】不要声称知道当前具体日期或时刻；仍需依据已有对话自然延续，不要随机换话题或把日程计划当作事实。';
      // Only an explicit manual action or a budgeted scheduled runner may call this generator;
      // reserve one shared API token immediately before the provider call.
      if (automatic && !reservePhoneApiBudget(characterId)) return;
      const { response, json } = await fetchCharacterPhoneJson(phoneApi.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+phoneApi.apiKey},
        body:JSON.stringify({model:phoneApi.model,stream:false,temperature:0.8,messages:[
          {role:'system',content:`以下是私聊真实的角色系统上下文（包括世界书、性格、生活状态）：${systemContext}。
你只负责补充手机主人Char（ID:${characterId}）的微信收件箱；不要代替User说话，也不要生成User聊天框，它从真实私聊数据库同步。
${scheduleContext}
${phoneTimeGuidance}
微信生成偏好：${JSON.stringify(prefs)}。
已有会话：${JSON.stringify(existing).slice(0,6500)}
已确认联系人：${JSON.stringify(profiles.map(p=>({id:p.id,nickname:p.nickname||p.name,realName:p.realName,identity:p.identity,relationship:p.relationship,personality:p.personality}))).slice(0,6500)}
这是增量更新，不是初始化或重建。优先挑选已有会话延续对话，根据偏好 chatDensity 设置消息数量：compact 每条会话1-3条、normal 2-5条、rich 4-9条。手动生成可适量包含更多类型的会话，背景刷新要节制。只有生活情境需要时才新增联系人或通知。不得重述、改写或重新生成已有消息，不得复制历史聊天气泡。涵盖真实生活中合适的亲友、学校/工作、普通事务、群通知、公众号和服务通知，不强制每类出现。不是所有人都热情友善；允许简短、冷淡、忙碌、无回复，禁止无意义互夸和装乖。仅模拟手机内容，不将模拟内容冒充真人感已经发生的事件。
当 officialAccounts=true 时，允许1~3条贴合人物的公众号、服务号、物流、工作学校、微信支付等官方信息；使用kind=service，服务号不属于Char的NPC朋友圈，不许捏造真实新闻内容。officialAccounts=false时不生成服务号。
当 paymentNotices=true 时，可新增0~3笔符合角色生活和经济状况的【虚构】微信支付消费。paymentNotices=false则payments为空数组。不能编造User实际转账或收款，不得从日程计划推断已付款，不得造重大金额。退款暂不生成。payments字段每笔 {"title":"商家/消费","kind":"expense","amount":12.5,"category":"日常","detail":"Char自己的消费"}，amount必须为0到5000的人民币正数。系统会自动将它记入微信支付通知及虚构账单，千万不要再在threads里重复写相同消费通知。
${fullSuite?`\n这次是「一次请求生成微信全套」，同时返回顶层 moments:{"npcPosts":[{"authorId":"已知联系人稳定ID","text":"新动态","comments":[{"authorId":"与作者确实认识的现有联系人ID或CharID","text":"独立评论"}]}],"charPost":{"publish":false,"text":""}}。只可让现有 NPC 和 Char 根据性格、已发生事件决定发不发；不能写 User 帖子。最多3条NPC贴、每条2条评论，Char可以不发。最近已有动态避免重复：${JSON.stringify(readCharacterMoments(characterId).slice(0,10).map(p=>({authorId:p.authorId,text:p.text.slice(0,120)}))).slice(0,1800)}。同一JSON内附上 moments，不可拆成多个响应；不新增单独 API 调用。` : ''}
严格返回JSON对象 {"threads":[{"contactId":"已确认联系人ID或新生成稳定ID","nickname":"微信网名","realName":"真实姓名（未知可为空）","identity":"身份或服务类型","personality":"性格/消息风格","speechStyle":"惯用口气","boundary":"交往边界","relationship":"与Char的关系","background":"背景","origin":"known|introduced|stranger","kind":"npc|group|service","messages":[{"speaker":"owner|contact","text":"微信气泡"}]}],"payments":[{"title":"商家/消费","kind":"expense","amount":12.5,"category":"日常","detail":"具体消费"}]}。已认识的人用known；新认识但已互相交流用introduced；陌生人用stranger。同名不能作为身份标识；新人物必须使用不同ID。服务号/群通知一般只有contact消息。不要创建User会话。不要markdown。`},
          {role:'user',content:'根据手机主人自己的生活和已有上下文，增量更新现有微信收件箱：优先续写已有联系人对话，适量补充新通知或新联系人。不得重复已有聊天。'+(fullSuite?' 同一轮顺便根据现有熟人关系生成可选朋友圈 moments；不强求发帖。':'')}
        ]})
      }, { charId: characterId, purpose: '微信收件箱批量更新', automatic: automatic });
      if(!response.ok) throw new Error(json?.error?.message || 'HTTP '+response.status);
      const raw=extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
      const data=JSON.parse(raw);
      if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('微信收件箱返回格式错误');
      // An optional full-suite subtask may be absent or malformed; save other
      // independently valid results instead of silently discarding the batch.
      if(chatsRevisionAtStart!==readPhoneContentClearRevision(characterId,'chats') ||
         contactsRevisionAtStart!==readPhoneContentClearRevision(characterId,'contacts')) return;
      const generatedThreads = Array.isArray(data.threads) ? data.threads : [];
      if(!fullSuite && !Array.isArray(data.threads)) throw new Error('微信收件箱返回格式错误');
      let savedNonChatItems=0;
      let savedThreads=0;
      let chatSaveFailed=false;
      const incoming: ChatRecord[]=[];
      const newContacts: Array<{id:string;item:any;established:boolean}> = [];
      // One LLM batch may mention the same new friend under different IDs.
      // Resolve within the batch before committing any conversation.
      const batchNpcIds = new Map<string, string>();
      // Re-read after the API call so the background NPC scheduler cannot
      // be overwritten by an older React render snapshot.
      const currentRecords = readCharacterPhoneChats(characterId);
      const currentProfiles = readNpcProfiles(characterId);
      const now=Date.now();
      for(const item of generatedThreads.slice(0,prefs.chatDensity==='rich'?12:9)){
        if(!item || typeof item.nickname!=='string' || !item.nickname.trim() || !Array.isArray(item.messages)) continue;
        if(!['npc','group','service'].includes(item.kind)) continue;
        if(item.kind==='service'&&!prefs.officialAccounts)continue;
        const linked=item.kind==='npc'?findKnownNpc(currentProfiles, {
          contactId: item.contactId, name: item.nickname,
          realName: item.realName, identity: item.identity, relationship: item.relationship,
        }):undefined;
        const previous=currentRecords.find(r=>r.contactId===item.contactId && item.contactId);
        const nicknameKey = (String(item.realName || item.nickname)).normalize('NFKC').trim().toLowerCase();
        const socialKey = item.kind === 'npc'
          ? nicknameKey + '|' + String(item.relationship || '').normalize('NFKC').trim().toLowerCase()
          : '';
        const normalizedName=String(item.nickname).normalize('NFKC').trim().toLowerCase().slice(0,55);
        const officialId=item.kind==='service'?'service:'+normalizedName:
          item.kind==='group'?'group:'+normalizedName:'';
        const id=officialId || linked?.id || previous?.contactId || (socialKey && batchNpcIds.get(socialKey)) ||
          (typeof item.contactId==='string' && item.contactId.startsWith('generated:') ? item.contactId : 'generated:'+crypto.randomUUID());
        if (socialKey && !batchNpcIds.has(socialKey)) batchNpcIds.set(socialKey,id);
        const messages=parseGeneratedPhoneMessages(item.messages,id);
        if(!messages.length) continue;
        const alreadyIncoming=incoming.find(r=>r.contactId===id);
        const existingRecord=alreadyIncoming || previous || currentRecords.find(r=>r.contactId===id);
        const seen=new Set((existingRecord?.messages||[]).slice(-24).map(m=>m.speaker?.role+'|'+m.text.trim()));
        const fresh=messages.filter(m=>{const k=m.speaker?.role+'|'+m.text.trim();if(seen.has(k))return false;seen.add(k);return true;});
        if(!fresh.length)continue;
        const updatedThread: ChatRecord = {id:existingRecord?.id||crypto.randomUUID(),contactId:id,
          kind:item.kind,name:linked?.remark||linked?.nickname||linked?.name||item.nickname.trim().slice(0,40),
          preview:fresh[fresh.length-1].text,time:now,messages:[...(existingRecord?.messages||[]),...fresh]};
        if (alreadyIncoming) incoming[incoming.indexOf(alreadyIncoming)] = updatedThread;
        else incoming.push(updatedThread);
        if(!linked && item.kind==='npc' && !newContacts.some(contact=>contact.id===id)) newContacts.push({
          id, item, established: fresh.some(m=>m.speaker.role==='owner') &&
            fresh.some(m=>m.speaker.role==='contact'),
        });
      }
      if(!incoming.length && !fullSuite) throw new Error('本次未生成有效微信会话，未保存');
      if(incoming.length){
        const replaced=new Set(incoming.map(x=>x.id));
        const updatedRecords = [...incoming,...currentRecords.filter(r=>!replaced.has(r.id))];
        try {
          updateCharacterPhoneChats(characterId, () => updatedRecords);
          savedThreads=incoming.length;
        } catch {
          chatSaveFailed=true;
          setError('本轮微信会话保存失败；已保留旧记录，正在尝试保存其他有效内容');
          if(!fullSuite) return;
        }
        if(savedThreads) setRecords(updatedRecords);
      }
      if (prefs.paymentNotices && Array.isArray(data.payments) &&
          paymentsRevisionAtStart===readPhoneContentClearRevision(characterId,'payments')) {
        try {
          const receipts=appendSimulatedPhonePayments(characterId,data.payments,now);
          if(receipts.length){
            savedNonChatItems+=receipts.length;
            const serviceId='service:微信支付';
            const receiptMessages=receipts.map(row=>({
              speaker:{role:'contact' as const,contactId:serviceId},
              text:'微信支付通知：'+row.title+' · '+(row.amountCents<0?'支出':'收入')+
                ' ¥'+(Math.abs(row.amountCents)/100).toFixed(2)+'；'+row.detail,
              createdAt:row.occurredAt,
            }));
            updateCharacterPhoneChats(characterId,old=>{
              const previousPay=old.find(v=>v.contactId===serviceId);
              const updated:ChatRecord={
                id:previousPay?.id||crypto.randomUUID(),contactId:serviceId,kind:'service',
                name:'微信支付',time:now,preview:receiptMessages[receiptMessages.length-1].text,
                messages:[...(previousPay?.messages||[]),...receiptMessages],
              };
              return [updated,...old.filter(v=>v.id!==updated.id)];
            });
            syncCharacterPhoneWalletPayments(characterId);
            setRecords(readCharacterPhoneChats(characterId));
          }
        }catch(error){console.warn('[CharacterPhone] receipt sync skipped',error);
          setError('微信消息已保存，但支付账单同步失败');}
      }
      // Contacts are created *after* real phone messages have been saved.
      // Established acquaintances enter the address book; strangers/request
      // only enter the existing pending contacts lane.
      for (const {id,item,established} of (savedThreads ? newContacts : [])) {
        try {
          const result = registerDiscoveredNpc(characterId, {
            contactId: id, name: item.nickname,
            nickname: item.nickname, realName: item.realName, identity: item.identity,
            personality: item.personality, relationship: item.relationship,
            background: item.background, speechStyle: item.speechStyle, boundary: item.boundary,
            origin: item.origin === 'known' ? 'introduced'
              : item.origin === 'stranger' ? 'stranger' : 'introduced',
            evidence: 'social',
          }, { conversationEstablished: established, blockedNames: [name, userProfile.name] });
          if (result.status === 'added' && result.profile) recordCharacterLifeEvent({
            id: 'contact:' + result.profile.id, characterId,
            kind: 'contact-added', occurredAt: result.profile.createdAt,
            source: 'phone', contactId: result.profile.id,
            summary: '微信生活中新增联系人：' + result.profile.name,
          });
        } catch (error) { console.warn('[CharacterPhone] contact discovery skipped', error); }
      }
      try { localStorage.setItem('sully_phone_inbox_auto_at:'+characterId,String(Date.now())); } catch { /* auto-refresh can retry */ }
      // Record only the messages that were actually saved, never treat a
      // scheduled activity as already completed.
      for (const thread of (savedThreads ? incoming : [])) {
        const oldThread = currentRecords.find(r=>r.id===thread.id);
        const newMessages = thread.messages.slice(oldThread?.messages.length || 0);
        if (!newMessages.length) continue;
        if (thread.contactId && thread.kind==='npc') noteNpcInteraction(characterId,thread.contactId,now,newMessages);
        if(thread.kind==='service')continue; // notifications are not confirmed real-world transactions
        recordCharacterLifeEvent({
          id:'npc-chat:inbox:'+thread.id+':'+now,
          characterId, kind:'npc-chat', occurredAt:now, source:'phone',
          contactId:thread.contactId,phoneThreadId:thread.id,
          summary:(newMessages.some(m=>m.speaker.role==='owner') ? '已保存的微信对话：' : '已收到但尚未回复的微信消息：')+newMessages.slice(-12).map(m=>(m.speaker.role==='owner'?name:thread.name)+'：'+m.text.trim()).join('；').slice(0,1200)
        });
      }
      // The manual full-suite response includes its own Moments without an
      // additional paid request. No posts are generated for User or unknown IDs.
      if(fullSuite&&data.moments&&typeof data.moments==='object' &&
         momentsRevisionAtStart===readPhoneContentClearRevision(characterId,'moments')){
        try{
          const known=readNpcProfiles(characterId);
          const listed=readCharacterMoments(characterId);
          const posts=Array.isArray(data.moments.npcPosts)?data.moments.npcPosts.slice(0,3):[];
          for(const item of posts){
            if(!item||typeof item.text!=='string'||!item.text.trim())continue;
            const author=known.find(person=>person.id===item.authorId);
            if(!author)continue;
            const text=item.text.trim().slice(0,1200);
            if(listed.some(old=>old.authorId===author.id&&old.text.trim()===text))continue;
            const post=publishCharacterMoment({characterId,authorId:author.id,origin:'npc',text,imageUrls:[],visibility:'all'});
            if(!post)continue;
            savedNonChatItems++;
            const comments=Array.isArray(item.comments)?item.comments.slice(0,2):[];
            for(const c of comments){
              const actorId=typeof c?.authorId==='string'?c.authorId:'';
              if(!actorId||actorId===author.id||typeof c?.text!=='string')continue;
              const actor=known.find(x=>x.id===actorId);
              if(actorId!==characterId&&(!actor||!author.mutualContactIds?.includes(actorId)||!actor.mutualContactIds?.includes(author.id)))continue;
              const body=c.text.trim().slice(0,200),live=readCharacterMoments(characterId).find(p=>p.id===post.id);
              if(!allowMomentComment(live?.comments||[],actorId,body))continue;
              if(addMomentComment(characterId,post.id,{id:crypto.randomUUID(),authorId:actorId,text:body,createdAt:Date.now()})) savedNonChatItems++;
            }
          }
          const own=data.moments.charPost;
          if(own?.publish===true&&typeof own.text==='string'&&own.text.trim()){
            const text=own.text.trim().slice(0,1200);
            const old=readCharacterMoments(characterId);
            if(!old.some(post=>post.authorId===characterId&&!post.deletedAt&&
              (post.text.trim()===text||Date.now()-post.createdAt<12*3600_000))){
              const post=publishCharacterMoment({characterId,origin:'char',text,imageUrls:[],visibility:'all'});
              if(post){
                savedNonChatItems++;
                recordCharacterLifeEvent({id:'moment:'+post.id,characterId,kind:'moment-post',
                  occurredAt:post.createdAt,source:'phone',summary:'Char 自主发布朋友圈：'+text.slice(0,100)});
              }
            }
          }
        }catch(error){console.warn('[CharacterPhone] suite moment partial save',error);}
      }
      if(!savedThreads && !savedNonChatItems) throw new Error(chatSaveFailed
        ? '本次微信会话保存失败，其他内容也未能保存；旧记录未删除，请检查可用存储空间。'
        : '本次 AI 没有返回可保存的新内容，原有手机记录未被更改。');
      setTab('chats');
      if(!automatic)setWechatNotice('本次新增或续写 '+savedThreads+' 条会话，另保存 '+savedNonChatItems+
        ' 项内容；'+(chatSaveFailed?'微信会话保存失败，其他内容已保留。':'原有记录已保留。'));
      return { threads:savedThreads, other:savedNonChatItems, partial:chatSaveFailed };
    } catch(e){if(fullSuite)throw e;setError(e instanceof Error?e.message:String(e));}
    finally{finishCharacterPhoneRefresh(characterId);setBusy(false);}
  };
  // Opening WeChat is read-only. No model requests simply for entering a tab.
  // The existing explicit + / per-thread generation controls stay available.
  const generate = async (npcName = '', guidance = '') => {
    if (busy || sharedWechatRefreshing) return;
    if (!phoneApi.apiKey || !phoneApi.baseUrl || !phoneApi.model) { setError('请先在 SullyOS 设置中配置聊天 API'); return; }
    const profile = profiles.find(p => p.id === npcName) || (!npcName && profiles.length === 1 ? profiles[0] : undefined);
    if (!profile) { setError('请先到通讯录生成 NPC 档案'); setTab('contacts'); return; }
    npcName = profile.name;
    if (!beginCharacterPhoneRefresh(characterId)) return;
    setBusy(true); setError('');
    const manualChatRevision=readPhoneContentClearRevision(characterId,'chats');
    try {
      const realContext = await loadRealContext();
      const target = records.find(r => r.contactId === profile.id);
      const context = records.slice(0, 6).map(r => r.name + '：' + r.messages.slice(-8).map(m => (m.speaker?.role === 'owner' ? '[手机主人]' : m.speaker?.role === 'contact' ? '[联系人]' : '[旧消息身份未验证]') + '：' + m.text).join(' / ')).join('\n');
      const { response, json } = await fetchCharacterPhoneJson(phoneApi.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + phoneApi.apiKey },
        body: JSON.stringify({ model: phoneApi.model, stream: false, temperature: 0.85, messages: [
          { role: 'system', content: `私聊原版上下文：${realContext.systemPrompt.slice(0, 14000)}。现在生成角色「${name}」手机里的微信消息，不要直接回复User。手机主人Char的ID是${characterId}。${scheduleContext}固定NPC档案：姓名${profile.name}，身份${profile.identity}，性格${profile.personality}，与角色关系${profile.relationship}，背景${profile.background}。必须严格遵守该档案，不得更名、改身份或改关系。请保持和私聊一致的自然、鲜活、口语化表达，有停顿、个性和真实关系边界，不要模板化、说教或夸张表演。角色和NPC都是虚构人物。${target ? `必须继续与现有联系人「${target.name}」聊天，不要换人或改名。之前的对话：${target.messages.slice(-16).map(m => (m.speaker?.role === 'owner' ? '[手机主人]' : m.speaker?.role === 'contact' ? '[联系人]' : '[旧消息身份未验证]') + '：' + m.text).join(' / ')}` : '根据角色背景创造一位合理的朋友、家人或同事，与角色进行一段生活化的微信对话。优先选择已有联系人，避免无意义地不断创建新朋友。'}对话不一定围绕用户。只输出合法JSON对象：{"name":"${profile.name}","messages":[{"speaker":"contact","text":"短消息"},{"speaker":"owner","text":"短消息"}]}。speaker只能为owner或contact，owner是手机主人Char，contact是当前联系人；即使双方同名或是水仙，也绝对不能根据名字推断发言者。User不是NPC，不能混入。必须生成8到14条独立的微信消息，双方都要有发言，每条一条气泡，禁止把整段对话塞入单条text。至少8条，否则视为失败。不要markdown。已有记录：${context}` },
          { role: 'user', content: '生成一段符合角色设定、像真实朋友微信聊天一样的日常对话。'+(guidance.trim()?'参考方向（不是User发送的消息）：'+guidance.trim().slice(0,300):'') }
        ] })
      }, { charId: characterId, purpose: '指定联系人微信对话', automatic: false });
      if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
      const raw = extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const data = JSON.parse(raw);
      if (typeof data.name !== 'string' || !Array.isArray(data.messages)) throw new Error('生成内容格式不正确');
      if(manualChatRevision!==readPhoneContentClearRevision(characterId,'chats'))return;
      const messages = parseGeneratedPhoneMessages(data.messages, profile.id);
      if (messages.length < 8 || !messages.some(m => m.speaker.role === 'owner') || !messages.some(m => m.speaker.role === 'contact')) throw new Error('生成不足8条有效消息或缺少一方发言，请重试（本次未保存）');
      const npc = profile.name;
      if (!npc) throw new Error('NPC 名称为空');
      // Rebase on current storage *after* the API call; an autonomous NPC
      // message may have arrived while the user's manual generation ran.
      const stored = readCharacterPhoneChats(characterId);
      const existing = stored.find(r => r.contactId === profile.id);
      const next: ChatRecord = { id: existing?.id || crypto.randomUUID(), contactId: profile.id, name: npc, preview: messages[messages.length - 1].text, time: Date.now(), messages: [...(existing?.messages || []), ...messages.map((m,i)=>({...m,createdAt:Date.now()-(messages.length-1-i)*25000}))] };
      try { updateCharacterPhoneChats(characterId, () => [next, ...stored.filter(r => r.id !== existing?.id)]); }
      catch { setError('聊天记录保存失败，本次不记录生活事件'); return; }
      setRecords(readCharacterPhoneChats(characterId));
      noteNpcInteraction(characterId, profile.id, next.time, messages);
      setTab('chats');
      recordCharacterLifeEvent({ id: 'npc-chat:' + next.id + ':' + next.time, characterId, kind: 'npc-chat', occurredAt: next.time, source: 'phone', phoneThreadId: next.id, summary: '已保存的微信对话：' + messages.slice(-12).map(m => (m.speaker.role === 'owner' ? name : npc) + '：' + m.text.trim()).join('；').slice(0, 1200), contactId: profile.id });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { finishCharacterPhoneRefresh(characterId);setBusy(false); }
  };
  const letCharDecideMoment = async () => {
    if(momentBusy) return;
    if(!phoneApi.apiKey || !phoneApi.baseUrl || !phoneApi.model){setError('请先配置聊天 API，Char 才能自主决定是否发朋友圈');return;}
    setMomentBusy(true);setError('');
    try {
      const context=await loadRealContext();
      const events=readCharacterLifeEvents(characterId).filter(e=>e.kind!=='moment-post' && e.kind!=='moment-comment').slice(0,18);
      const recent=readCharacterMoments(characterId).slice(0,8).map(p=>({text:p.text,time:p.createdAt,deleted:!!p.deletedAt}));
      const { response, json } = await fetchCharacterPhoneJson(phoneApi.baseUrl.replace(/\/+$/,'')+'/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+phoneApi.apiKey},
        body:JSON.stringify({model:phoneApi.model,stream:false,temperature:0.85,messages:[
          {role:'system',content:`你是角色${name}的朋友圈自主决策器。根据真实私聊上下文、角色人设、世界书、日程及已发生的生活事件判断角色现在是否愿意发朋友圈。角色可以自恋、炫耀、冷淡、毒舌、琐碎，也可以完全不发；不要讨好User。不要把想法、猜测、日程计划当成已经发生的事实。绝不能伪造聊天截图、现实照片或未发生的事件。当前日程：${scheduleContext}。私聊真实上下文：${context.systemPrompt.slice(0,30000)}。已记录的生活事件：${JSON.stringify(events).slice(0,7500)}。近期朋友圈：${JSON.stringify(recent).slice(0,3500)}。只返回JSON：{"publish":true或false,"text":"符合角色口吻的朋友圈文字","eventIds":["引用的真实事件ID"]}。如果没有想发的内容，publish为false。首阶段只发纯文字，图片由后续独立生图系统提供。`},
          {role:'user',content:'由Char自己决定此刻要不要发布一条朋友圈。'}
        ]})
      }, { charId: characterId, purpose: '角色朋友圈发布决策', automatic: false });
      if(!response.ok)throw new Error(json?.error?.message||'HTTP '+response.status);
      const data=JSON.parse(extractContent(json).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
      if(data.publish!==true){setError(name+'现在不想发朋友圈');return;}
      if(typeof data.text!=='string'||!data.text.trim())throw new Error('AI 未返回有效朋友圈文字');
      const ids=Array.isArray(data.eventIds)?data.eventIds.filter((id:unknown):id is string=>typeof id==='string'&&events.some(e=>e.id===id)):[];
      const post=publishCharacterMoment({characterId,origin:'char',text:data.text.trim().slice(0,2000),imageUrls:[],visibility:'all',provenance:{eventIds:ids,decision:ids.length?'event-triggered':'spontaneous'}});
      if(!post)throw new Error('朋友圈保存失败');
      recordCharacterLifeEvent({id:'moment:'+post.id,characterId,kind:'moment-post',occurredAt:post.createdAt,source:'phone',summary:'Char 自主发布朋友圈：'+post.text.slice(0,100)});
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setMomentBusy(false);}
  };
  const loadNpcMoments=async()=>{if(npcMomentLoading||sharedMomentsRefreshing||isCharacterPhoneRefreshing(characterId,'moments'))return;setNpcMomentLoading(true);setError('');try{await refreshNpcMoments(characterId,readNpcProfiles(characterId),phoneApi);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setNpcMomentLoading(false);}};
  const generateFullWechatManually=async()=>{
    if(wechatSuiteBusy||busy||sharedWechatRefreshing||npcMomentLoading||momentBusy)return;
    if(!phoneApi.baseUrl||!phoneApi.model||!phoneApi.apiKey){
      setError('请先在查手机设置中配置可用的 API');return;
    }
    setWechatSuiteBusy(true);setWechatSuiteNotice('');
    try{
      // One explicit user action; reuse all three existing generation entrypoints.
      // Each part saves its own results; a failed part cannot erase old content.
      const result=await generateInbox(false,true);
      if(!result){setWechatSuiteNotice('手机已有生成任务正在进行，本次没有发起新的请求。');return;}
      setWechatSuiteNotice('本次调用一次 API，保存了 '+result.threads+' 条微信会话和 '+result.other+
        ' 项其他内容；'+(result.partial?'微信会话保存失败，其他有效结果已保留。':'旧记录保留。'));
    }catch(err){setWechatSuiteNotice(err instanceof Error?err.message:'本次批量生成未全部完成，可再试一次');}
    finally{setWechatSuiteBusy(false);}
  };
  const isPrivateThread = thread === 'private:' + characterId;
  const active = records.find(r => r.id === thread);
  // Read-only life side: recorded facts, never a chat reply or a planned schedule slot.
  const confirmedLifeGlimpses = selectConfirmedLifeGlimpses(lifeEvents, characterId);
  const privatePreview = privateThread?.messages[privateThread.messages.length-1];
  const deleteChat = (id: string) => {
    if (id === 'private:' + characterId) { setHiddenPrivate(true); try {localStorage.setItem('sully_phone_hide_private:'+characterId,'1');} catch {} }
    else try {
      if(deleteCharacterPhoneChat(characterId,id))setRecords(readCharacterPhoneChats(characterId));
    }catch { setError('微信聊天或关联的生活侧面清理失败，请检查可用存储空间'); }
    setSwipedId('');
  };
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
  return <div className={phoneAppearance.fullscreen
    ? 'fixed inset-0 z-[1000] flex items-center justify-center bg-[#ededed] p-0'
    : 'fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-2'}
    role="dialog" aria-modal="true" aria-label={name + '的手机'}>
    <div className={phoneAppearance.fullscreen
      ? 'flex h-[100dvh] w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-none border-0 bg-[#ededed]'
      : 'flex h-[min(91dvh,780px)] w-[min(88vw,344px)] min-h-0 max-w-[344px] flex-col overflow-hidden rounded-[25px] border-[4px] border-[#252525] bg-[#ededed] shadow-2xl'}
      style={phoneAppearance.fullscreen?{
        paddingTop:'env(safe-area-inset-top, 0px)',
        paddingBottom:'env(safe-area-inset-bottom, 0px)',
      }:undefined}>
      <PhoneStatusBar characterId={characterId} showBattery={phoneAppearance.showBattery}/>
      {!phoneUnlocked ? <CharacterPhoneLockScreen characterId={characterId} name={name} avatar={phoneAvatar}
        onUnlock={unlockPhone} onClose={onClose}/> : <>
      {screen === 'home'||screen === 'beautify'||isCharacterPhoneSocialAppId(screen) ? null :
        <header className="flex shrink-0 items-center gap-3 border-b border-[#dcdcdc] bg-[#ededed] px-4 py-3">
          <button type="button" onClick={back} aria-label="返回"><ArrowLeft size={23}/></button>
          <h2 className="min-w-0 flex-1 truncate text-center text-[19px] font-medium text-[#181818]">{screen === 'wechat' ? ({ chats: '微信', contacts: '通讯录', discover: '发现', me: '我' }[tab]) : screen === 'thread' ? (isPrivateThread ? userProfile.name : active?.name) : screen === 'contact-detail' ? contact?.name : ({ moments: '朋友圈', wallet: '钱包', settings: '设置', memo:'备忘录',gallery:'相册',calls:'电话',sms:'短信',browser:'浏览器',profile:'个人资料' } as Record<string,string>)[screen]}</h2>
          {screen === 'wechat' && tab === 'chats' ? <div className="flex gap-4"><button type="button" aria-label="搜索聊天" onClick={() => {setWechatSearchOpen(v=>!v);setWechatQuery('');}}><MagnifyingGlass size={23}/></button><button type="button" aria-label="批量更新微信消息" disabled={busy || sharedWechatRefreshing} onClick={() => void generateInbox()}>{busy || sharedWechatRefreshing ? <SpinnerGap size={24} className="animate-spin"/> : <Plus size={25}/>}</button></div> : <span className="w-6"/>}
        </header>}
      <main className={'min-h-0 flex-1 '+(screen==='home'?'overflow-hidden':'overflow-y-auto')}>
        {error && <div role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-700">{error}<button className="ml-3 underline" onClick={() => setError('')}>关闭</button></div>}
        {screen === 'home' && <CharacterPhoneHome characterId={characterId} name={name} avatar={phoneAvatar}
          userAvatar={userProfile.perCharAvatars?.[characterId]||userProfile.avatar} userName={userProfile.name}
          installPlan={installPlan} installBusy={installBusy} installNotice={installNotice}
          onOpen={openHomeApp} onRetryInstall={()=>void runPhoneInstall()} onClose={onClose}/>} 
        {screen === 'beautify' && <CharacterPhoneBeautify characterId={characterId} onBack={()=>setScreen('home')}/>}
        {isCharacterPhoneSocialAppId(screen) && <CharacterPhoneSocialApps key={screen}
          appId={screen} ownerName={name} ownerAvatar={phoneAvatar} onBack={()=>setScreen('home')}
          char={char} userProfile={userProfile} groups={groups} realtimeConfig={realtimeConfig} api={phoneApi}/>}
        {screen === 'wechat' && tab === 'chats' && <div>
          {wechatNotice&&<div role="status" className="flex items-center justify-between gap-2 border-b border-[#ececec] bg-[#f7f7f7] px-4 py-2 text-[11px] text-[#777]"><span>{wechatNotice}</span><button type="button" onClick={()=>setWechatNotice('')} className="shrink-0 underline">关闭</button></div>}
          {wechatSearchOpen&&<div className="border-b border-[#eee] bg-white px-4 py-3">
            <input aria-label="搜索微信聊天" placeholder="搜索联系人、公众号或消息预览"
              value={wechatQuery} onChange={e=>setWechatQuery(e.target.value)} autoFocus
              className="w-full rounded-xl bg-[#f1f1f1] px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-[#aaa]"/>
          </div>}
          {!hiddenPrivate && privateThread && <div className="flex bg-white" onTouchStart={e=>setTouchX(e.touches[0].clientX)} onTouchEnd={e=>{if(touchX!==null && e.changedTouches[0].clientX-touchX>65)setSwipedId(privateThread.id);setTouchX(null);}}>
            <button type="button" onClick={()=>{setThread(privateThread.id);setScreen('thread');}} className="flex min-w-0 flex-1 items-center gap-3 border-b border-[#eee] px-4 py-3 text-left"><PhoneAvatar src={userProfile.perCharAvatars?.[characterId] || userProfile.avatar} name={userProfile.name} className="h-12 w-12 rounded-lg text-base"/><span className="min-w-0 flex-1"><span className="block truncate text-base">{userProfile.name} <small className="text-[#888]">真实私聊</small></span><span className="block truncate text-xs text-[#999]">{privatePreview?.text || '暂无私聊消息'}</span></span></button>{swipedId===privateThread.id&&<button type="button" onClick={()=>deleteChat(privateThread.id)} className="bg-red-500 px-4 text-white">删除</button>}
          </div>}
          {records.filter(r=>(r.name+' '+r.preview).toLocaleLowerCase().includes(wechatQuery.trim().toLocaleLowerCase())).map(r=><div key={r.id} className="flex bg-white" onTouchStart={e=>setTouchX(e.touches[0].clientX)} onTouchEnd={e=>{if(touchX!==null && e.changedTouches[0].clientX-touchX>65)setSwipedId(r.id);setTouchX(null);}}>
            <button type="button" onClick={()=>{setThread(r.id);setScreen('thread');}} className="flex min-w-0 flex-1 items-center gap-3 border-b border-[#eee] px-4 py-3 text-left">{r.kind==='service'||r.contactId?.startsWith('service:')?
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#ddd] bg-gradient-to-br from-[#eee] to-white text-[#555]">
                {r.name.includes('支付')?<CreditCard size={28}/>:r.name.includes('公众号')?<BookOpen size={27}/>:<Megaphone size={27}/>}
              </span>:
              r.kind==='group'||r.contactId?.startsWith('group:')?
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#dedede] text-[#555]"><UsersThree size={26}/></span>:
              <PhoneAvatar src={profiles.find(p=>p.id===r.contactId)?.avatar} name={r.name} className="h-12 w-12 rounded-lg text-xl"/>}<span className="min-w-0 flex-1"><span className="block truncate text-[17px]">{r.name}</span><span className="block truncate pt-1 text-[13px] text-[#999]">{r.preview}</span></span><span className="text-xs text-[#aaa]">{timeLabel(r.time)}</span></button>{swipedId===r.id&&<button type="button" onClick={()=>deleteChat(r.id)} className="bg-red-500 px-4 text-white">删除</button>}
          </div>)}
          {!records.length && (!privateThread || hiddenPrivate) && <p className="p-8 text-center text-sm text-[#999]">暂无微信消息</p>}
        </div>}
        {screen === 'wechat' && tab === 'contacts' && <div className="bg-white">
          <button type="button" onClick={()=>{setAddingContact(v=>!v);setDraft({name:'',identity:'',personality:'',relationship:'',background:''});setRealNameDraft('');}} className="flex w-full items-center gap-3 border-b border-[#eee] px-5 py-3 text-left"><span className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-400 text-white"><Plus size={24}/></span>添加朋友</button>
          {pendingContacts.length>0 && <div className="bg-[#ededed] px-5 py-2 text-xs text-[#888]">新的朋友 · {pendingContacts.length} 个待确认</div>}
          {pendingContacts.map(request=><div key={request.id} className="flex items-center gap-2 border-b border-[#eee] bg-white px-4 py-3"><span className="flex h-10 w-10 items-center justify-center rounded bg-[#b4d4c3]">{request.nickname.slice(0,1)}</span><div className="min-w-0 flex-1"><div className="truncate text-sm">{request.nickname}</div><div className="truncate text-xs text-[#999]">{request.identity}</div></div><button type="button" className="rounded bg-[#07b75b] px-3 py-2 text-xs text-white" onClick={()=>acceptRequest(request)}>添加</button><button type="button" className="rounded bg-[#eee] px-3 py-2 text-xs" onClick={()=>dismissRequest(request.id)}>忽略</button></div>)}
          {hiddenPrivate && <button type="button" className="w-full border-b border-[#eee] px-5 py-3 text-left text-sm text-[#1b9c5a]" onClick={()=>{setHiddenPrivate(false);try{localStorage.removeItem('sully_phone_hide_private:'+characterId);}catch{}}}>恢复显示 User 真实私聊</button>}
          {currentSlot && <div className="bg-[#ededed] px-5 py-2 text-xs text-[#777]">当前生活状态 · {currentSlot.activity}{currentSlot.location ? ' · '+currentSlot.location : ''}</div>}

          {addingContact && <div className="space-y-2 bg-white px-5 py-3"><label className="flex items-center gap-2 text-sm"><span className="w-20 shrink-0">真实姓名</span><input value={realNameDraft} onChange={e=>setRealNameDraft(e.target.value)} className="min-w-0 flex-1 rounded border border-[#ddd] p-2" placeholder="可选，与网名独立"/></label>{([{key:'name',label:'微信昵称'},{key:'identity',label:'身份'},{key:'personality',label:'性格'},{key:'relationship',label:'与Char关系'},{key:'background',label:'背景'}] as const).map(({key,label})=><label key={key} className="flex items-start gap-2 text-sm"><span className="w-20 shrink-0 pt-2">{label}</span><textarea rows={key==='background'?3:1} value={draft[key]} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))} className="min-w-0 flex-1 rounded border border-[#ddd] p-2"/></label>)}<button type="button" onClick={addManualContact} className="w-full rounded bg-[#07b75b] py-2 text-white">保存联系人</button></div>}
          <div className="bg-[#ededed] px-5 py-2 text-xs text-[#888]">联系人 · {profiles.length}</div>
          {[...profiles].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(p=><button type="button" key={p.id} onClick={()=>openContact(p)} className="flex w-full items-center gap-3 border-b border-[#eee] px-5 py-3 text-left"><PhoneAvatar src={p.avatar} name={p.name} className="h-11 w-11 rounded-md text-lg"/><span className="min-w-0 flex-1"><span className="block truncate text-base">{p.name}</span><span className="block truncate text-xs text-[#999]">{p.relationship}</span></span><span className="text-[#bbb]">›</span></button>)}
        </div>}
        {screen === 'contact-detail' && contact && <div className="space-y-3 pb-6">
          <div className="flex items-center gap-4 bg-white px-5 py-6"><PhoneAvatar src={contact.avatar} name={contact.name} className="h-16 w-16 rounded-lg text-2xl"/><div><h3 className="text-xl font-semibold">{contact.name}</h3><p className="text-sm text-[#888]">{contact.identity}</p></div></div>
          <div className="bg-white"><div className="flex gap-3 border-b border-[#eee] px-5 py-4 text-sm"><span className="w-14 shrink-0 text-[#888]">真实姓名</span><span>{contact.realName || '未填写'}</span></div>{([{key:'name',label:'姓名'},{key:'identity',label:'身份'},{key:'relationship',label:'关系'},{key:'personality',label:'性格'},{key:'background',label:'背景'}] as const).map(({key,label})=><div key={key} className="flex gap-3 border-b border-[#eee] px-5 py-4 text-sm"><span className="w-14 shrink-0 text-[#888]">{label}</span>{editing?<textarea rows={key==='background'||key==='personality'?3:1} value={draft[key]} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))} className="min-w-0 flex-1 resize-none bg-transparent outline-none"/>:<span className="whitespace-pre-wrap">{contact[key]}</span>}</div>)}</div>
          <div className="space-y-3 px-5">{editing?<><button type="button" onClick={saveContact} className="w-full rounded-lg bg-[#07b75b] py-3 text-white">保存档案</button><button type="button" onClick={()=>setEditing(false)} className="w-full rounded-lg bg-white py-3">取消</button></>:<><button type="button" onClick={()=>setEditing(true)} className="w-full rounded-lg bg-white py-3">编辑联系人资料</button><button type="button" disabled={busy} onClick={()=>{setScreen('wechat');setTab('contacts');void generate(contact.id);}} className="w-full rounded-lg bg-[#07b75b] py-3 text-white disabled:opacity-50">AI生成聊天</button></>}</div>
        </div>}
        {screen === 'wechat' && tab === 'discover' && row('朋友圈',<Images size={23}/>,()=>setScreen('moments'))}
        {screen === 'wechat' && tab === 'me' && <div className="pt-4">
           <button type="button" onClick={()=>{profileOrigin.current='wechat';setScreen('profile');}} className="flex w-full items-center gap-4 bg-white px-5 py-5 text-left">
             <PhoneAvatar src={phoneAvatar} name={name} className="h-16 w-16 rounded-xl text-xl"/>
             <span className="min-w-0 flex-1"><strong className="block truncate text-xl">{name}</strong>
               <span className="mt-1 block truncate text-xs text-[#999]">{selfProfile.pokeSuffix ? '戳一戳'+selfProfile.pokeSuffix : '查看我的资料与头像库'}</span>
             </span><span className="text-[#aaa]">›</span>
           </button>
           <div className="mt-3">{row('钱包',<Wallet size={23}/>,()=>setScreen('wallet'))}{row('搜索设置',<MagnifyingGlass size={23}/>,()=>{settingsOrigin.current='wechat';setScreen('settings');})}{row('设置',<GearSix size={23}/>,()=>{settingsOrigin.current='wechat';setScreen('settings');})}</div>
         </div>}
        {screen === 'thread' && isPrivateThread && <div className="space-y-4 p-4">{privateThread?.messages.map(m=><div key={m.id} className={'flex items-start gap-2.5 '+(m.speakerId.startsWith('owner:')?'flex-row-reverse':'')}><PhoneAvatar src={m.speakerId.startsWith('owner:') ? phoneAvatar : (userProfile.perCharAvatars?.[characterId] || userProfile.avatar)} name={m.speakerId.startsWith('owner:') ? name : userProfile.name} className="h-10 w-10 rounded-lg text-sm"/><div className={'relative max-w-[78%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm '+(m.speakerId.startsWith('owner:')?'bg-[#95ec69]':'bg-white')}><span className={'absolute top-3 h-2.5 w-2.5 rotate-45 '+(m.speakerId.startsWith('owner:')?'-right-1 bg-[#95ec69]':'-left-1 bg-white')}/><span className="relative">{m.text}</span></div></div>)}</div>}
        {screen === 'thread' && !isPrivateThread && <PhoneChatBubbles messages={active?.messages||[]} ownerAvatar={phoneAvatar} contactAvatar={profiles.find(p=>p.id===active?.contactId)?.avatar} ownerName={name} contactName={active?.name||''}/>}
        {screen === 'moments' && <PullToRefresh loading={npcMomentLoading||sharedMomentsRefreshing} onRefresh={loadNpcMoments}><div className="min-h-full bg-white"><div className="relative h-64 bg-gradient-to-br from-[#8f9fab] via-[#b8c9ce] to-[#e0e4e1]"><strong className="absolute bottom-5 right-24 text-xl text-white drop-shadow">{name}</strong><PhoneAvatar key={phoneAvatar||name} src={phoneAvatar} name={name} className="absolute -bottom-8 right-5 h-20 w-20 rounded-xl border-4 border-white text-3xl"/></div><div className="h-24"/><MomentsTimeline name={name} characterId={characterId} posts={moments} contacts={profiles} charAvatar={phoneAvatar} userProfile={userProfile}/></div></PullToRefresh>}
        {screen === 'profile' && <div className="space-y-4 pb-8 text-[#252525]">
           <section className="bg-white px-5 py-7">
             <div className="flex items-center gap-5">
               <button type="button" aria-label="打开角色头像库" onClick={()=>setAvatarLibraryOpen(true)}>
                 <PhoneAvatar src={phoneAvatar} name={name} className="h-[84px] w-[84px] rounded-2xl text-2xl"/>
               </button>
               <div className="min-w-0 flex-1"><h3 className="truncate text-xl font-semibold">{name}</h3>
                 <p className="mt-1 text-xs text-[#999]">此手机主人 · Char</p>
                 
               </div>
             </div>
           </section>
           <section className="mx-4 rounded-xl bg-white px-4 py-3">
             <label className="flex items-center justify-between gap-3 text-[13px] text-[#444]">
               <span><strong className="block">独立生活侧面 AI 展开</strong>
                 <span className="mt-1 block text-[11px] leading-5 text-[#888]">默认关闭；开启后仍需逐条手动点击，每次使用一次已配置的对话 API。不会改私聊提示词或自动生成手机内容。</span>
               </span>
               <input type="checkbox" checked={manualGlimpseEnabled} onChange={e=>toggleManualGlimpse(e.target.checked)} className="h-5 w-5 shrink-0 accent-[#444]" />
             </label>
             {glimpseNotice && <p role="status" className="mt-2 text-xs leading-5 text-[#777]">{glimpseNotice}</p>}
           </section>
           {confirmedLifeGlimpses.length > 0 && <details className="mx-4 overflow-hidden rounded-xl bg-white">
             <summary className="cursor-pointer px-4 py-4 text-sm font-semibold text-[#333]">生活侧面 · 已发生的片段（{confirmedLifeGlimpses.length}）</summary>
             <div className="border-t border-[#eee] px-4 pb-4 pt-2">
               <p className="pb-2 text-[11px] leading-5 text-[#888]">仅原事件摘要是已确认事实；AI 展开只表示独立叙事，不增加真实事件、不作为私聊或 NPC 微信。</p>
               <ol className="space-y-3">
                 {confirmedLifeGlimpses.map(event=><li key={event.id} className="border-l-2 border-[#dedede] pl-3">
                   <span className="block text-[11px] text-[#888]">{ChatPrompts.formatDate(event.occurredAt,resolveCharTimeZone(char))} · {event.source==='phone'?'私人手机':event.source==='amsg2'?'主动联系':event.source==='real-mode'?'生活行动':event.source==='chat'?'聊天相关记录':'其他已存记录'}</span>
                   <span className="mt-1 block whitespace-pre-wrap break-words text-[13px] leading-5 text-[#444]">{event.summary}</span>
                   {event.glimpse?.anchorSummary === event.summary && <div className="mt-2 rounded-lg bg-[#f6f6f6] px-3 py-2">
                     <span className="block pb-1 text-[10px] text-[#999]">AI 独立描述 · 非新增事实</span>
                     <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[#666]">{event.glimpse.text}</p>
                   </div>}
                   {manualGlimpseEnabled && <button type="button"
                     disabled={glimpseGeneratingId !== null}
                     onClick={()=>void expandLifeGlimpse(event)}
                     className="mt-2 rounded-lg border border-[#ddd] px-3 py-2 text-[11px] text-[#555] disabled:opacity-40">
                     {glimpseGeneratingId === event.id ? '正在展开…' : event.glimpse ? '重新展开（1 次 API）' : '展开这段生活（1 次 API）'}
                   </button>}
                 </li>)}
               </ol>
             </div>
           </details>}
           <div className="bg-white">{row('头像库',<Images size={23}/>,()=>setAvatarLibraryOpen(true))}</div>
           <section className="bg-white px-5 py-5">
             <h4 className="text-sm font-semibold">戳一戳后缀</h4>
             <p className="mt-3 rounded-xl bg-[#f4f4f4] p-4 text-sm">{selfProfile.pokeSuffix
               ? '戳了戳'+name+selfProfile.pokeSuffix : '还没有后缀，Char 可以自己设置'}</p>
             {selfProfile.reason && <p className="mt-2 text-xs leading-5 text-[#888]">Char 的想法：{selfProfile.reason}</p>}
             <div className="mt-4 grid grid-cols-2 gap-3">
               <button type="button" onClick={()=>onPoke(selfProfile.pokeSuffix)} className="rounded-xl bg-[#ececec] px-3 py-3 text-sm">戳一戳</button>
               <button type="button" disabled={selfAutoBusy} onClick={()=>void adjustSelfProfile()}
                 className="rounded-xl bg-[#303030] px-3 py-3 text-sm text-white disabled:opacity-50">
                 {selfAutoBusy?'Char 正在调整…':'让 Char 自改'}
               </button>
             </div>
             {selfAutoNotice && <p role="status" className="mt-3 text-xs leading-5 text-[#777]">{selfAutoNotice}</p>}
           </section>
           <p className="px-5 text-xs leading-5 text-[#999]">与私聊共用头像库和戳一戳功能。头像先识图后保存；情绪选头像暂时停用，已存图片不受影响。</p>
         </div>}
         {screen === 'memo' && <PhoneMemo characterId={characterId} onGenerate={generateMemo} generating={memoBusy}/>}
        {screen === 'gallery' && <Gallery lockedCharacterId={characterId} onExit={()=>setScreen('home')}/>}
        {screen === 'calls' && <p className="p-8 text-center text-sm text-[#888]">电话记录与拨号功能待接入</p>}
        {screen === 'sms' && <p className="p-8 text-center text-sm text-[#888]">短信收发功能待接入</p>}
        {screen === 'browser' && <CharacterPhoneBrowser characterId={characterId} char={char} userProfile={userProfile} groups={groups} realtimeConfig={realtimeConfig} api={phoneApi}/>}
        {screen === 'wallet' && <CharacterPhoneWallet characterId={characterId} char={char} userProfile={userProfile} groups={groups} realtimeConfig={realtimeConfig} api={phoneApi}/>}
        {screen === 'settings' && <div className="space-y-3 p-4">
          <label className="flex items-center gap-3 rounded-2xl border border-[#e9e9e9] bg-white px-4 py-3">
            <MagnifyingGlass size={20} color="#888"/>
            <input type="search" value={settingsQuery} onChange={e=>setSettingsQuery(e.target.value)}
              placeholder="搜索微信设置功能…" aria-label="搜索微信设置功能"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#333] outline-none"/>
            {settingsQuery&&<button type="button" className="text-xs text-[#888]" onClick={()=>setSettingsQuery('')}>清除</button>}
          </label>
          {!settingsQuery && <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#f4f4f4] p-1" role="group" aria-label="手机设置范围">
            {([{id:'common',label:'常用设置'},{id:'advanced',label:'更多设置'}] as const).map(v=>
              <button key={v.id} type="button" aria-pressed={settingsView===v.id}
                onClick={()=>setSettingsView(v.id)}
                className={'rounded-xl px-3 py-3 text-sm '+(settingsView===v.id?'bg-white font-semibold shadow-sm text-[#222]':'text-[#777]')}>
                {v.label}</button>)}
          </div>}
          {!settingsQuery && settingsView==='common' && <section className="rounded-2xl bg-[#f5f5f5] px-4 py-3 text-xs leading-5 text-[#666]" aria-label="当前手机运行方式">
            <strong className="block text-[13px] text-[#333]">当前使用方式</strong>
            <p>{npcAutonomyEnabled && phonePrefs.backgroundApiEnabled
              ? '允许 Char 在网页前台、遇到已有生活事件或需要回复的 NPC 时自主处理手机'
              : '独立自主生成已暂停；查看已有内容、手动生成仍可使用'}</p>
            <p>{phonePrefs.chatPiggybackEnabled
              ? '私聊同轮附带手机内容：已开启（若主动消息 2.0 同时开启，也可随云端自主联系回复旧 NPC 微信）'
              : '私聊同轮附带手机内容：未开启'}</p>
            <p>每个应用仍遵守原来的手动／自动选择；无需为普通浏览调整下面的高级参数。</p>
          </section>}
          {showPhoneSettings('common',"微信 消息 生成 推送 公众号 服务号 微信支付 支付 账单 聊天 丰富 精简 密度") && <PhoneSettingsGroup title="微信消息生成" searching={!!settingsQuery}>
          <section className="space-y-3 rounded-2xl bg-white p-4">
            <h3 className="sr-only">微信消息生成</h3>
            <p className="text-xs leading-5 text-[#888]">手动刷新采用一次批量请求，按 Char 的设定生成不同会话；不会为每条公众号通知单独调用 API。</p>
            <div className="rounded-xl border border-[#e7e7e7] bg-[#fafafa] p-3">
              <h4 className="text-[13px] font-semibold text-[#444]">一键生成微信内容</h4>
              <p className="mt-1 text-xs leading-5 text-[#888]">手动：只用一次 API 生成微信消息、联系人、NPC 朋友圈及 Char 的可选动态。第一次建立内容，之后依据人设、日程和已保存聊天续写。原有的单项生成按钮保留。</p>
              <button type="button" disabled={wechatSuiteBusy||busy||sharedWechatRefreshing||npcMomentLoading||momentBusy}
                onClick={()=>void generateFullWechatManually()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#343434] px-3 py-3 text-xs text-white disabled:opacity-40">
                {wechatSuiteBusy&&<SpinnerGap size={16} className="animate-spin"/>}
                {wechatSuiteBusy?'正在一次生成…':'手动一键生成微信全套（1 次 API）'}
              </button>
              {wechatSuiteNotice&&<p role="status" className="mt-2 text-[11px] leading-5 text-[#666]">{wechatSuiteNotice}</p>}
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-[#ececec] bg-[#fafafa] px-3 py-3 text-xs">
              <span className="min-w-0">
                <strong className="block text-[13px] font-semibold text-[#444]">自动更新优先处理微信与朋友圈</strong>
                <span className="mt-1 block leading-5 text-[#888]">开启后，遇到有依据的手机活动机会时优先处理 NPC 微信与朋友圈；关闭后允许其他已开启的手机自主功能参与，不代表关闭 NPC 微信续聊。没有待回复消息或已发生的生活事件时不会仅因定时检查而生成。这个优先项不会修改“Char 手机自主生活”总开关；总开关关闭时，优先项保持设置但不会触发自动生成。要暂停独立自主生成，可关闭“Char 手机自主生活”或“允许独立后台 AI 请求”。</span>
              </span>
              <input type="checkbox" checked={inboxPrefs.autoFullWeChat}
                onChange={e=>{
                  // This preference only chooses which existing phone
                  // features get priority. It must never silently re-enable
                  // the separate Char autonomy master switch.
                  updateInboxPrefs({autoFullWeChat:e.target.checked});
                }} className="h-5 w-5 shrink-0 accent-[#444]"/>
            </label>
            <label className="flex items-center justify-between gap-3 text-xs"><span>允许公众号／服务号推送</span>
              <input type="checkbox" checked={inboxPrefs.officialAccounts} onChange={e=>updateInboxPrefs({officialAccounts:e.target.checked})} className="h-5 w-5 accent-[#444]"/></label>
            <label className="flex items-center justify-between gap-3 text-xs"><span>允许虚构微信支付账单</span>
              <input type="checkbox" checked={inboxPrefs.paymentNotices} onChange={e=>updateInboxPrefs({paymentNotices:e.target.checked})} className="h-5 w-5 accent-[#444]"/></label>
            <div className="grid grid-cols-3 gap-2">
              {([{id:'compact',label:'精简'},{id:'normal',label:'正常'},{id:'rich',label:'丰富'}] as const).map(x=><button type="button" key={x.id}
                onClick={()=>updateInboxPrefs({chatDensity:x.id})} className={'rounded-xl border px-1 py-2.5 text-[11px] '+(inboxPrefs.chatDensity===x.id?'border-[#333] bg-[#333] text-white':'border-[#ddd] bg-[#f7f7f7]')}>{x.label}</button>)}
            </div>
          </section>
          </PhoneSettingsGroup>}
          {showPhoneSettings('advanced',"应用 安装 卸载 社交 微博 Ins Instagram X 哔哩哔哩 B站 豆瓣 抖音 邮箱 晋江 网易云") && <PhoneSettingsGroup title="可选应用安装" searching={!!settingsQuery}>
          <section className="space-y-3 rounded-2xl bg-white p-4">
            <h3 className="sr-only">Char 的可选应用安装</h3>
            <p className="text-xs leading-5 text-[#888]">首次进入只根据 Char 性格分析一次；基础软件永远保留。以后可以手动安装、卸载九款可选应用。</p>
            <div className="divide-y divide-[#eee]">
              {CHARACTER_PHONE_SOCIAL_APPS.map(appId=><label key={appId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="scale-[.68]"><CharacterPhoneSocialIcon appId={appId}/></span>
                  <span className="min-w-0">
                    <strong className="block truncate font-medium">{CHARACTER_PHONE_SOCIAL_APP_INFO[appId].label}</strong>
                    <span className="block truncate text-[11px] text-[#999]">{CHARACTER_PHONE_SOCIAL_APP_INFO[appId].subtitle}</span>
                  </span>
                </span>
                <input type="checkbox" className="h-5 w-5 accent-[#444]"
                  checked={!!installPlan?.installedAppIds.includes(appId)}
                  onChange={e=>changeSocialAppInstalled(appId,e.target.checked)}/>
              </label>)}
            </div>
            {installPlan?.reason&&<p className="text-xs leading-5 text-[#888]">{installPlan.reason}</p>}
            {installNotice&&<p role="alert" className="text-xs text-[#666]">{installNotice}</p>}
            <button type="button" disabled={installBusy} onClick={()=>void runPhoneInstall(true)}
              className="w-full rounded-xl border border-[#ccc] bg-[#f6f6f6] px-3 py-3 text-xs disabled:opacity-50">
              {installBusy?'正在分析安装…':'重新分析（会覆盖当前的安装选择）'}
            </button>
          </section>
          </PhoneSettingsGroup>}
          {showPhoneSettings('common',"API 模型 Key 地址 独立 查手机 接口") && <PhoneSettingsGroup title="查手机独立 API" searching={!!settingsQuery}>
          <section className="space-y-3 rounded-2xl bg-white p-4">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span><span className="block font-semibold">查手机独立 API</span>
                <span className="mt-1 block text-xs leading-5 text-[#888]">只供当前 Char 的微信、朋友圈、浏览器、备忘录和钱包 AI 使用，不改私聊和主动消息</span></span>
              <input type="checkbox" className="h-5 w-5 accent-[#444]" checked={phoneApiSettings.enabled}
                onChange={e=>changePhoneApiSettings({enabled:e.target.checked})}/>
            </label>
            {phoneApiSettings.enabled && <div className="space-y-3 text-sm">
              <label className="block space-y-1"><span>从全局 API 预设套用</span>
                <select value="" aria-label="从全局 API 预设套用" onChange={event=>{
                  const selected=apiPresets.find(p=>p.id===event.target.value);
                  if(selected?.config)changePhoneApiSettings({enabled:true,baseUrl:selected.config.baseUrl,apiKey:selected.config.apiKey,model:selected.config.model});
                }} className="w-full rounded-xl border border-[#ddd] bg-[#fafafa] px-3 py-2.5 outline-none focus:border-[#666]">
                  <option value="">选择现有预设…</option>
                  {apiPresets.map(p=><option key={p.id} value={p.id}>{p.group?`${p.group} / `:''}{p.name}</option>)}
                </select>
                <span className="block text-[11px] leading-5 text-[#888]">复制预设的地址、Key、模型到当前 Char 的查手机；不改全局预设，可继续单独编辑。</span>
              </label>
              <label className="block space-y-1"><span>API 地址</span>
                <input type="url" autoComplete="off" placeholder="https://.../v1" value={phoneApiSettings.baseUrl}
                  onChange={e=>changePhoneApiSettings({baseUrl:e.target.value})}
                  className="w-full rounded-xl border border-[#ddd] bg-[#fafafa] px-3 py-2.5 outline-none focus:border-[#666]"/>
              </label>
              <label className="block space-y-1"><span>API Key</span>
                <input type="password" autoComplete="off" placeholder="仅保存在此设备" value={phoneApiSettings.apiKey}
                  onChange={e=>changePhoneApiSettings({apiKey:e.target.value})}
                  className="w-full rounded-xl border border-[#ddd] bg-[#fafafa] px-3 py-2.5 outline-none focus:border-[#666]"/>
              </label>
              <label className="block space-y-1"><span>模型名称</span>
                <input type="text" autoComplete="off" placeholder="输入模型 ID" value={phoneApiSettings.model}
                  onChange={e=>changePhoneApiSettings({model:e.target.value})}
                  className="w-full rounded-xl border border-[#ddd] bg-[#fafafa] px-3 py-2.5 outline-none focus:border-[#666]"/>
              </label>
              <p className="text-xs leading-5 text-[#777]">
                {/^https?:\/\//i.test(phoneApiSettings.baseUrl)&&phoneApiSettings.apiKey&&phoneApiSettings.model
                  ? '独立 API 已启用；关闭开关即可恢复使用原聊天 API。'
                  : '请填完整的地址、Key 和模型；未填完整时暂用原聊天 API。'}
              </p>
            </div>}
          </section>
          </PhoneSettingsGroup>}
          {showPhoneSettings('common',"自主 真人感 生活 NPC 自动 总开关") && <PhoneSettingsGroup title="Char 手机自主生活" searching={!!settingsQuery}>
          <label className="flex items-center justify-between gap-4 rounded-2xl bg-white px-4 py-4 text-sm">
            <span className="space-y-1"><span className="block font-semibold text-[#222]">Char 手机自主生活</span>
              <span className="block text-xs leading-5 text-[#777]">控制独立前台自主任务（NPC 微信、朋友圈、浏览器和个人资料）；关闭后手动生成和私聊同轮生成选项不受影响</span></span>
            <input type="checkbox" className="h-5 w-5 accent-[#444]" checked={npcAutonomyEnabled}
              onChange={event=>{try{setCharacterPhoneAutonomyEnabled(characterId,event.target.checked);setNpcAutonomyEnabled(event.target.checked);}catch{setError('设置保存失败');}}}/>
          </label>
          </PhoneSettingsGroup>}
          {showPhoneSettings('advanced',"朋友圈 评论 互动 回复 点赞 频率 档位 时间 限流 去重") && <PhoneSettingsGroup title="朋友圈 NPC 生成与互动" searching={!!settingsQuery}>
          <section className="space-y-4 rounded-2xl bg-white p-4 text-xs">
            <label className="flex items-center justify-between gap-3">
              <span><strong className="block text-[13px]">允许 NPC 自主评论／回复／点赞</strong>
                <span className="block mt-1 text-[#888]">只允许真实保存的熟人关系参与；不会冒充 User 留言。</span></span>
              <input type="checkbox" checked={momentPrefs.enabled} onChange={e=>changeMomentPrefs({enabled:e.target.checked})} className="h-5 w-5 accent-[#444]"/>
            </label>
            <label className="flex items-center justify-between gap-3">
              <span><strong className="block text-[13px]">允许 NPC 自主发布朋友圈</strong>
                <span className="block mt-1 text-[#888]">生成新动态的同一次 API 可以附带熟人评论与作者回复；不强制发帖。</span></span>
              <input type="checkbox" checked={momentPrefs.npcPostingEnabled}
                onChange={e=>changeMomentPrefs({npcPostingEnabled:e.target.checked})}
                className="h-5 w-5 accent-[#444]"/>
            </label>
            {(momentPrefs.enabled||momentPrefs.npcPostingEnabled)&&<>
              <div className="grid grid-cols-3 gap-2">
                {([{id:'quiet',label:'安静'},{id:'balanced',label:'正常'},{id:'lively',label:'热闹'}] as const).map(x=><button key={x.id} type="button"
                  onClick={()=>changeMomentPrefs({pace:x.id})} aria-pressed={momentPrefs.pace===x.id}
                  className={'rounded-xl border px-1 py-2.5 '+(momentPrefs.pace===x.id?'border-[#333] bg-[#333] text-white':'border-[#ddd] bg-[#f7f7f7]')}>{x.label}</button>)}
              </div>
              <label className="flex items-center justify-between gap-2"><span>两轮评论检查最短间隔（分钟）</span>
                <input type="number" min={15} max={1440} step={15} value={momentPrefs.intervalMinutes}
                  onChange={e=>{if(e.target.value!=='')changeMomentPrefs({intervalMinutes:Number(e.target.value)});}}
                  className="w-24 rounded-lg border border-[#ddd] px-2 py-2 text-right"/>
              </label>
              <label className="flex items-center justify-between gap-2"><span>NPC 新动态最短生成间隔（分钟）</span>
                <input type="number" min={60} max={1440} step={30} value={momentPrefs.npcPostIntervalMinutes}
                  onChange={e=>{if(e.target.value!=='')changeMomentPrefs({npcPostIntervalMinutes:Number(e.target.value)});}}
                  className="w-24 rounded-lg border border-[#ddd] px-2 py-2 text-right"/>
              </label>
              <p className="text-[11px] leading-5 text-[#888]">安静／正常／热闹：NPC 每天最多尝试新动态 1／2／3 次；每日互动最多 4／8／12 次、每条动态最多 4／8／12 条评论。熟人互认才可以互评，同一个人一条主评论及至多一次回复；禁止接龙和重复台词。自主生成仍受全局调用预算与总开关保护。</p>
            </>}
          </section>
          </PhoneSettingsGroup>}
          {showPhoneSettings('common',"AI 频率 额度 预算 高 中 低 省额度 均衡 活跃 自定义 间隔") && <PhoneSettingsGroup title="AI 自主调用频率" searching={!!settingsQuery}>
          <section className="space-y-4 rounded-2xl bg-white p-4">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-[#ddd] bg-[#fafafa] px-3 py-3 text-xs">
              <span><strong className="block text-[13px]">私聊同轮生成 NPC 微信／朋友圈</strong>
                <span className="block mt-1 leading-5 text-[#888]">角色私聊回复可以在同次生成中附带虚构 NPC 手机互动。若还开启了这个角色的主动消息 2.0，并使用兼容的云端 Worker，原有每日自主联系也可顺带回复一条已保存的 NPC 待回微信，关网页后结果可在下次上线时补收。这里不会另启一轮 API，但会增加输出 token；关掉独立后台 AI 请求或前台手机自主生活不会关闭此项。关闭本项或主动消息 2.0 就不再云端顺带回复。</span></span>
              <input type="checkbox" checked={phonePrefs.chatPiggybackEnabled}
                onChange={e=>changePhonePrefs({chatPiggybackEnabled:e.target.checked})}
                className="h-5 w-5 shrink-0 accent-[#444]"/>
            </label>
            {phonePrefs.chatPiggybackEnabled && (
              <p className="rounded-xl bg-[#f6f6f6] px-3 py-2 text-[11px] leading-5 text-[#777]">
                {char.activeMsg2Config?.enabled !== true
                  ? '离线 NPC 微信续聊尚不能运行：还需为这个角色开启主动消息 2.0，且部署兼容的 Worker。无需手动创建第一条每日任务。'
                  : safelySelectCloudPhoneOpportunity(char)
                    ? '本地有符合条件的已保存 NPC 待回消息。下次成功同步到新版 Worker、每日自主联系到点时，角色可选择在同次生成里回复；不保证每次都会回复。'
                    : '同轮权限已允许，目前没有符合条件的虚构 NPC 待回微信。云端不会凭空编造联系人或生活经历；仍需兼容的 Worker 才能离线运行。'}
              </p>
            )}
            <label className="flex items-center justify-between gap-3 rounded-xl border border-[#ddd] bg-[#fafafa] px-3 py-3 text-xs">
              <span><strong className="block text-[13px]">允许独立后台 AI 请求</strong>
                <span className="block mt-1 leading-5 text-[#888]">关闭后，手机的独立自主 AI 任务不会再调用接口；原有手动生成、User 私聊，以及另行开启的“私聊同轮生成”不受影响。开启后仍遵守下方共享预算。</span></span>
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#444]" checked={phonePrefs.backgroundApiEnabled}
                onChange={e=>changePhonePrefs({backgroundApiEnabled:e.target.checked})}/>
            </label>
            <div><h3 className="sr-only">AI 自主调用频率</h3>
              <p className="mt-1 text-xs leading-5 text-[#888]">档位只限制自主 API 的每日使用上限与请求间隔，不是自动发送时间表。只有出现已保存的生活事件、未回复的 NPC 消息等真实契机，系统才会考虑后台请求。手动生成不占用该预算。</p>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              {([{id:'economy',label:'省额度'},{id:'balanced',label:'均衡'},
                 {id:'active',label:'活跃'},{id:'custom',label:'自定义'}] as const).map(option=>
                <button key={option.id} type="button" aria-pressed={phonePrefs.pace===option.id}
                  onClick={()=>changePhonePrefs({pace:option.id})}
                  className={'rounded-xl border px-1 py-3 '+(phonePrefs.pace===option.id
                    ? 'border-[#333] bg-[#353535] text-white':'border-[#ddd] bg-[#f5f5f5]')}>
                  {option.label}</button>)}
            </div>
            {phonePrefs.pace==='custom' && <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1"><span className="block">每日自主调用上限（1—100）</span>
                <input type="number" min={1} max={100} step={1}
                  value={phonePrefs.customDailyLimit} onChange={e=>{
                    if(e.target.value!=='') changePhonePrefs({customDailyLimit:Number(e.target.value)});
                  }} className="w-full rounded-lg border border-[#ddd] p-2.5"/>
              </label>
              <label className="space-y-1"><span className="block">最短调用间隔（5—180 分钟）</span>
                <input type="number" min={5} max={180} step={1}
                  value={phonePrefs.customIntervalMinutes} onChange={e=>{
                    if(e.target.value!=='') changePhonePrefs({customIntervalMinutes:Number(e.target.value)});
                  }} className="w-full rounded-lg border border-[#ddd] p-2.5"/>
              </label>
            </div>}
            <div className="rounded-xl bg-[#f4f4f4] px-4 py-3 text-xs leading-6 text-[#666]">
              <p>今日自主 API 调用：{budgetInfo.requests} / {budgetInfo.limit} 次</p>
              <p>剩余：{budgetInfo.remaining} 次 · 至少间隔 {budgetInfo.minIntervalMinutes} 分钟</p>
              {budgetInfo.remaining>0 && budgetInfo.nextAllowedAt>Date.now() &&
                <p>最早允许再调用：{new Date(budgetInfo.nextAllowedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}（不是计划发消息时间）</p>}
              {budgetInfo.remaining===0&&<p>今日已达到上限，按设备当地日期自动重置。</p>}
            </div>
          </section>
          </PhoneSettingsGroup>}
          {showPhoneSettings('advanced',"百度 搜索 浏览器 头像 个人资料 戳一戳 后缀") && <PhoneSettingsGroup title="其他自主功能" searching={!!settingsQuery}>
          <section className="divide-y divide-[#eee] rounded-2xl bg-white px-4">
            <label className="flex items-center justify-between gap-3 py-4 text-sm">
              <span><span className="block font-medium">Char 自主搜百度</span>
                <span className="mt-1 block text-xs text-[#888]">有生活动机才搜索，记录理由，不制造网页结果</span></span>
              <input type="checkbox" className="h-5 w-5 accent-[#444]" checked={phonePrefs.browserAutoEnabled}
                onChange={e=>changePhonePrefs({browserAutoEnabled:e.target.checked})}/>
            </label>
            <label className="flex items-center justify-between gap-3 py-4 text-sm">
              <span><span className="block font-medium">个人资料／戳一戳后缀</span>
                <span className="mt-1 block text-xs text-[#888]">每天最多自动评估一次；基于情绪的自动换头像已暂停</span></span>
              <input type="checkbox" className="h-5 w-5 accent-[#444]" checked={phonePrefs.selfProfileAutoEnabled}
                onChange={e=>changePhonePrefs({selfProfileAutoEnabled:e.target.checked})}/>
            </label>
          </section>
          </PhoneSettingsGroup>}
          {showPhoneSettings('advanced','清除 管理 删除 数据 清理 备忘录 钱包 账号 浏览')&&<CharacterPhoneClearManager characterId={characterId} disabled={busy||sharedWechatRefreshing||npcMomentLoading}/>}
          <p className="px-2 text-xs leading-5 text-[#888]">
            默认省额度。自定义仅调整共享 API 预算；微信、浏览器和个人资料仍有独立冷却，避免空转刷请求。档位到时间不会自动触发角色行为；仅在有已保存的经历或未回复的 NPC 消息、且日程允许时才考虑调用。不会在网页关闭后持续请求。
            手动刷新和显式点击的生成按钮仍可使用聊天 API。主动消息 2.0 使用原来独立的机制，不受这里的预算影响。
          </p>
        </div>}
      </main>
      {screen === 'thread' && active && !isPrivateThread && <form className="flex shrink-0 items-center gap-2 border-t border-[#ddd] bg-[#f8f8f8] px-3 py-3" onSubmit={e=>{e.preventDefault();const guidance=chatComposer;setChatComposer('');void generate(active.contactId||active.name,guidance);}}><input aria-label="聊天续写方向" placeholder="输入聊天方向（可留空）" value={chatComposer} onChange={e=>setChatComposer(e.target.value)} className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-sm outline-none"/><button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-[#07b75b] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy?'续写中…':'发送'}</button></form>}
      {screen === 'wechat' && <nav className="grid shrink-0 grid-cols-4 border-t border-[#ddd] bg-[#f8f8f8] py-2">{([{id:'chats',label:'微信',Icon:ChatCircleDots},{id:'contacts',label:'通讯录',Icon:UsersThree},{id:'discover',label:'发现',Icon:Compass},{id:'me',label:'我',Icon:User}] as const).map(({id,label,Icon})=><button key={id} onClick={()=>setTab(id)} className={`flex flex-col items-center gap-1 text-xs ${tab===id?'text-[#07b75b]':'text-[#222]'}`}><Icon size={26} weight={tab===id?'fill':'regular'}/>{label}</button>)}</nav>}
      {screen !== 'wechat' && screen !== 'home' && screen !== 'beautify' && !isCharacterPhoneSocialAppId(screen) && <footer className="flex shrink-0 justify-center border-t border-[#ddd] bg-[#fafafa] py-2"><button type="button" onClick={()=>setScreen('home')} aria-label="返回手机桌面"><House size={21}/></button></footer>}
      </>}
    </div>
    {avatarLibraryOpen && createPortal(
      <CharacterAvatarLibraryModal characterId={characterId} defaultAvatar={char.avatar}
        visionApiConfig={phoneApi.visionApi} onClose={()=>setAvatarLibraryOpen(false)}
        onApply={onApplyAvatar}/>,
      document.body
    )}
  </div>;
}
