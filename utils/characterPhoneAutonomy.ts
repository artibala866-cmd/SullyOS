import type { CharacterProfile, UserProfile, GroupProfile, RealtimeConfig } from '../types';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import { readPhoneContentClearRevision } from './characterPhoneContentClearRevision';
import { classifyLifeActivity } from './sullyLifeClock';
import {isLocalChatLeaseActive} from './amsgChatGenerationLease';
import { readCharacterLifeEvents, recordCharacterLifeEvent } from './characterLifeEvents';
import { readNpcProfiles, type NpcProfile } from './characterPhoneNpcs';
import { readPendingContacts } from './characterPhoneRequests';
import { registerDiscoveredNpc, noteNpcInteraction, type NpcDiscovery } from './characterNpcNetwork';
import { appendCharacterPhoneMessages, readCharacterPhoneChats, type CharacterPhoneChat } from './characterPhoneChats';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { ChatPrompts } from './chatPrompts';
import { ContextBuilder } from './context';
import { resolveCharTimeZone } from './timezone';
import { extractContent } from './safeApi';
import { fetchCharacterPhoneJson, canRunAutomaticPhoneAi } from './characterPhoneAiRequest';
import { isCharacterPhoneRefreshing } from './characterPhoneRefreshTracker';
import { canUsePhoneApiBudget, reservePhoneApiBudget, readPhoneAutonomyPreferences, readPhoneAutonomyRevision, bumpPhoneAutonomyRevision } from './characterPhoneApiBudget';
import { resolveCharacterPhoneApi } from './characterPhoneApiConfig';

/** NPC phone autonomy shares the existing schedule/phone/event/AMSG pipeline.
 * This scheduler ONLY writes the character-owned phone, never sends User a message
 * and never creates a second AMSG task. AMSG reads the resulting life events.
 */
type Api = { baseUrl: string; apiKey: string; model: string };
export type CharacterPhoneAutonomyInput = {
  char: CharacterProfile;
  user: UserProfile;
  groups: GroupProfile[];
  realtimeConfig?: RealtimeConfig;
  api: Api;
  /** Answer an already saved NPC message without creating contacts or unrelated chats. */
  replyOnly?: boolean;
};
export type PhoneAutonomyOutcome = 'skipped' | 'generated-contacts' | 'messaged' | 'unavailable' | 'failed';
type RunState = { day: string; turnsToday: number; attemptsToday: number; lastAttemptAt: number; bootstrapAt: number; contactAt: Record<string, number> };
const PREFIX = 'sully_character_phone_autonomy_v1:';
const locks = new Set<string>();
export const isCharacterPhoneAutonomyEnabled = (charId: string): boolean => {
  try { return localStorage.getItem('sully_phone_autonomy_disabled_v1:' + charId) !== '1'; }
  catch { return false; }
};
export function setCharacterPhoneAutonomyEnabled(charId: string, enabled: boolean): void {
  if (enabled) localStorage.removeItem('sully_phone_autonomy_disabled_v1:' + charId);
  else localStorage.setItem('sully_phone_autonomy_disabled_v1:' + charId, '1');
  bumpPhoneAutonomyRevision(charId);
  window.dispatchEvent(new CustomEvent('sully:character-phone-autonomy-changed', { detail: { characterId: charId, enabled } }));
}
const DAY = 24 * 3600000;

function readState(charId: string, now: number): RunState {
  const day = new Date(now).toLocaleDateString('en-CA');
  try {
    const row = JSON.parse(localStorage.getItem(PREFIX + charId) || '{}');
    return {
      day,
      turnsToday: row.day === day && Number.isFinite(row.turnsToday) ? row.turnsToday : 0,
      attemptsToday: row.day === day && Number.isFinite(row.attemptsToday) ? row.attemptsToday : 0,
      lastAttemptAt: Number.isFinite(row.lastAttemptAt) ? row.lastAttemptAt : 0,
      bootstrapAt: Number.isFinite(row.bootstrapAt) ? row.bootstrapAt : 0,
      contactAt: row.contactAt && typeof row.contactAt === 'object' ? row.contactAt : {},
    };
  } catch { return { day, turnsToday: 0, attemptsToday: 0, lastAttemptAt: 0, bootstrapAt: 0, contactAt: {} }; }
}
function writeState(id: string, state: RunState) { localStorage.setItem(PREFIX + id, JSON.stringify(state)); }
async function queryJson(api: Api, messages: { role: 'system' | 'user'; content: string }[], charId: string, purpose: string): Promise<any> {
  const { response, json } = await fetchCharacterPhoneJson(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
    body: JSON.stringify({ model: api.model, stream: false, temperature: 0.8, messages }),
  }, { charId, purpose, automatic: true });
  if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
  const raw = extractContent(json).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(raw);
}
function knownContactSnapshot(rows: NpcProfile[]): unknown {
  return rows.slice(0, 50).map(p => ({
    id: p.id, name: p.name, identity: p.identity, relationship: p.relationship,
    personality: p.personality.slice(0, 200), speechStyle: p.speechStyle,
  }));
}

/** One-time, bounded bootstrap from the real character prompt/worldbooks.
 * Known people become contacts, merely suggested people only become contacts
 * when the character is established as knowing them; strangers get requests.
 */
async function bootstrapSocialCircle(input: CharacterPhoneAutonomyInput, expectedRevision: number): Promise<boolean> {
  const { char, user, groups, realtimeConfig } = input;
  const api = resolveCharacterPhoneApi(char.id,input.api);
  const context = await buildCharacterPhoneContext(char, user, groups, realtimeConfig);
  const existing = readNpcProfiles(char.id);
  const pending = readPendingContacts(char.id);
  const contactsClearRevision = readPhoneContentClearRevision(char.id, 'contacts');
  // Building the phone context may await DB reads. If the user toggled the
  // permission while that was pending, do not start a new billable request.
  if (!isCharacterPhoneAutonomyEnabled(char.id) ||
      !readPhoneAutonomyPreferences(char.id).backgroundApiEnabled ||
      readPhoneAutonomyRevision(char.id) !== expectedRevision ||
      isCharacterPhoneRefreshing(char.id)) return false;
  const response = await queryJson(api, [
    { role: 'system', content: `你为虚构角色${char.name}整理其手机通讯录中的真实生活圈。
必须遵守以下原设/世界书/私聊上下文，禁止改写已有角色身份、家庭、职业、恋爱关系。
${context.systemPrompt.slice(0, 11000)}
已有联系人：${JSON.stringify(knownContactSnapshot(existing)).slice(0, 3000)}
待确认联系人：${JSON.stringify(pending.map(p => p.nickname)).slice(0, 500)}
从原设提取最多三位有姓名/可辨称呼的亲友、同事、同学或邻居。
如果原设人物不足，可以补充最多两位符合角色生活圈的普通熟人，但不得凭空指定恋人/亲属关系。
origin为known时必须能从原设或世界书找到证据，evidence取worldbook或character；
自行推导的熟人origin=introduced、evidence=suggested，偶遇陌生人origin=stranger。
说话习惯要有差异：允许冷淡、简短、较真、慢回、私人边界，避免人人热情讨好。
仅返回JSON：{"contacts":[{"name":"","nickname":"","realName":"","identity":"","personality":"","relationship":"","background":"","speechStyle":"","boundary":"","origin":"known|introduced|stranger","evidence":"worldbook|character|suggested"}]}。` },
    { role: 'user', content: '建立角色自己的基本生活圈，不用用户手工编人设。新角色必须服从已有设定；没有必要不要造人。' },
  ], char.id, '自动整理通讯录');
  // An explicit clear (even of an empty directory), a manual contact edit or
  // disabling phone autonomy while the request was in flight cancels its writes.
  if (!isCharacterPhoneAutonomyEnabled(char.id) ||
      !readPhoneAutonomyPreferences(char.id).backgroundApiEnabled ||
      readPhoneAutonomyRevision(char.id) !== expectedRevision ||
      isCharacterPhoneRefreshing(char.id) ||
      contactsClearRevision !== readPhoneContentClearRevision(char.id, 'contacts') ||
      JSON.stringify(readNpcProfiles(char.id)) !== JSON.stringify(existing) ||
      JSON.stringify(readPendingContacts(char.id)) !== JSON.stringify(pending)) return false;
  if (!Array.isArray(response?.contacts)) return false;
  let created = false;
  for (const raw of response.contacts.slice(0, 4)) {
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) continue;
    // LLM's claimed "known" provenance is only accepted when the source
    // character's actual prompt contains this identifiable person.
    const hasExplicitSeed = typeof raw.name === 'string' &&
      raw.name.trim().length >= 2 && context.systemPrompt.includes(raw.name.trim());
    const item: NpcDiscovery = {
      name: raw.name, nickname: raw.nickname, realName: raw.realName,
      identity: raw.identity, personality: raw.personality,
      relationship: raw.relationship, background: raw.background,
      speechStyle: raw.speechStyle, boundary: raw.boundary,
      origin: raw.origin === 'known' && !hasExplicitSeed ? 'introduced' :
        ['known', 'introduced', 'stranger'].includes(raw.origin) ? raw.origin : 'suggested',
      evidence: hasExplicitSeed && ['worldbook', 'character'].includes(raw.evidence)
        ? raw.evidence : 'suggested',
    };
    const result = registerDiscoveredNpc(char.id, item, { blockedNames: [char.name, user.name] });
    // An event listener may synchronously change settings while this loop
    // persists the previous contact. Stop immediately on that revision.
    if (readPhoneAutonomyRevision(char.id) !== expectedRevision) break;
    if (result.status === 'added' || result.status === 'pending') created = true;
    if (result.status === 'added' && result.profile) recordCharacterLifeEvent({
      id: 'contact:' + result.profile.id, characterId: char.id, kind: 'contact-added',
      occurredAt: result.profile.createdAt, source: 'phone', contactId: result.profile.id,
      summary: '角色生活圈新增联系人：' + result.profile.name,
    });
  }
  return created;
}

function formatPhoneElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '时间未知';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '不足1分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

type Decision = {
  contact: NpcProfile;
  thread?: CharacterPhoneChat;
  actor: 'owner' | 'contact';
  why: 'unanswered' | 'new-contact' | 'follow-up';
};
function chooseAction(charId: string, contacts: NpcProfile[], threads: CharacterPhoneChat[], state: RunState, now: number, busy: boolean): Decision | null {
  const available = contacts.filter(p => p.id !== charId && p.name && p.personality && p.source !== 'character');
  const eligible = available.filter(contact => now - (state.contactAt[contact.id] || 0) >= 45 * 60_000);

  // 1) A persisted unanswered message is the only high-priority reason to reply.
  const unanswered = eligible.flatMap(contact => {
    const thread = threads.find(row => row.contactId === contact.id);
    const last = thread?.messages[thread.messages.length - 1];
    if (last?.speaker.role !== 'contact') return [];
    const lastAt = last.createdAt || thread?.time || 0;
    const waitMs = now - lastAt;
    if (waitMs <= (busy ? 60 : 7) * 60_000) return [];
    return [{ contact, thread, actor: 'owner' as const, why: 'unanswered' as const, waitMs }];
  });
  if (unanswered.length) {
    unanswered.sort((a, b) => b.waitMs - a.waitMs || a.contact.id.localeCompare(b.contact.id));
    const { contact, thread, actor, why } = unanswered[0];
    return { contact, thread, actor, why };
  }

  if (!eligible.length) return null;

  // 2) Otherwise require a concrete anchor: a recent new contact or a follow-up to
  //    an existing message from Char. Do not rotate through stale contacts by clock bucket.
  type FollowupCandidate = Decision & { recentAt: number; createdAt: number };
  const candidates = eligible.flatMap((contact): FollowupCandidate[] => {
    const thread = threads.find(row => row.contactId === contact.id);
    const last = thread?.messages[thread.messages.length - 1];
    const createdAt = contact.createdAt || 0;
    const recentAt = Math.max(thread?.time || 0, state.contactAt[contact.id] || 0, last?.createdAt || 0);
    const contactAge = now - createdAt;
    if (!last && createdAt > 0 && contactAge > 5 * 60_000 && contactAge <= 3 * DAY) {
      return [{ contact, thread, recentAt, createdAt, actor: (busy ? 'contact' : 'owner') as 'owner' | 'contact', why: 'new-contact' as const }];
    }
    if (last?.speaker.role === 'owner' && now - recentAt > 4 * 60 * 60_000) {
      return [{ contact, thread, recentAt, createdAt, actor: 'contact' as const, why: 'follow-up' as const }];
    }
    return [];
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const priority = (a.why === 'follow-up' ? 0 : 1) - (b.why === 'follow-up' ? 0 : 1);
    if (priority) return priority;
    if (a.why === 'follow-up') return a.recentAt - b.recentAt || a.contact.id.localeCompare(b.contact.id);
    return b.createdAt - a.createdAt || a.contact.id.localeCompare(b.contact.id);
  });
  const { contact, thread, actor, why } = candidates[0];
  return { contact, thread, actor, why };
}

export async function runCharacterPhoneAutonomy(input: CharacterPhoneAutonomyInput): Promise<PhoneAutonomyOutcome> {
  const { char } = input;
  const api = char?.id ? resolveCharacterPhoneApi(char.id,input.api) : input.api;
  if (!char?.id || !api?.apiKey || !api.baseUrl || !api.model ||
      typeof document === 'undefined' || document.visibilityState !== 'visible' ||
      !isCharacterPhoneAutonomyEnabled(char.id)) return 'unavailable';
  // User-triggered refresh/continuation owns the inbox while its LLM call is
  // in flight. Never start a competing background write in the same window.
  if (isCharacterPhoneRefreshing(char.id) || isLocalChatLeaseActive(char.id) ||
      !canUsePhoneApiBudget(char.id) ||
      !canRunAutomaticPhoneAi(char.id, api.baseUrl.replace(/\/+$/, '') + '/chat/completions')) return 'skipped';
  if (locks.has(char.id)) return 'skipped';
  locks.add(char.id);
  const expectedRevision = readPhoneAutonomyRevision(char.id);
  const stillAuthorized = () => isCharacterPhoneAutonomyEnabled(char.id) &&
    readPhoneAutonomyPreferences(char.id).backgroundApiEnabled &&
    readPhoneAutonomyRevision(char.id) === expectedRevision;
  const now = Date.now();
  try {
    const state = readState(char.id, now);
    if (state.turnsToday >= 9 || state.attemptsToday >= 12 || now - state.lastAttemptAt < 18 * 60_000) return 'skipped';
    // Check the character's own schedule BEFORE bootstrap or reserving any
    // API call. The prior order could create new NPCs while Char was asleep.
    const life = await getCharacterLifeScheduleContext(char, new Date(now));
    if (!stillAuthorized() || isCharacterPhoneRefreshing(char.id) ||
        isLocalChatLeaseActive(char.id)) return 'skipped';
    const busyStatus = classifyLifeActivity(char.scheduleFeatureEnabled === false ? '' : (life.plannedActivity || ''));
    if (busyStatus === 'sleep') return 'skipped';
    // Reserve the attempt BEFORE the network request. The app may be reopened or
    // multiple phone surfaces may ask for updates in the same time window.
    state.lastAttemptAt = now;
    writeState(char.id, state);
    const contacts = readNpcProfiles(char.id);
    const threads = readCharacterPhoneChats(char.id);
    const decision = chooseAction(char.id, contacts, threads, state, now, busyStatus === 'busy');
    // Keep real ongoing conversations ahead of optional social bootstrap.
    // A small address book is NOT a reason to ignore someone's saved message.
    if (!decision && !input.replyOnly && contacts.length < 4 && now - state.bootstrapAt > DAY) {
      if (!reservePhoneApiBudget(char.id)) return 'skipped';
      state.bootstrapAt = now;
      state.attemptsToday++;
      writeState(char.id, state);
      try {
        if (await bootstrapSocialCircle(input, expectedRevision)) return 'generated-contacts';
      } catch (error) { console.warn('[PhoneAutonomy] NPC bootstrap skipped', error); }
      // Even a skipped/failed bootstrap was an API attempt. Never fall through
      // into a second, separately billed NPC turn during the same opportunity.
      return 'skipped';
    }
    if (!decision || (input.replyOnly && decision.why !== 'unanswered')) return 'skipped';
    const { contact, thread, actor, why } = decision;
    const charTimeZone = resolveCharTimeZone(char);
    const timeAwarenessOn = char.timeAwarenessEnabled !== false;
    const timeContext = timeAwarenessOn ? ContextBuilder.buildTimeAwarenessBlock(char) : '';
    const timeContextText = timeAwarenessOn
      ? (timeContext || '角色本地当前时间不可用；不要猜测具体日期或时刻。')
      : '角色的时间感知已关闭；不要声称知道当前具体日期或时间。';
    const historyMessages = (thread?.messages || []).slice(-16);
    const history = historyMessages.map((m, index) => {
      const timestamp = typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)
        ? m.createdAt
        : (index === historyMessages.length - 1 ? thread?.time : undefined);
      const at = timeAwarenessOn && typeof timestamp === 'number' && Number.isFinite(timestamp)
        ? ChatPrompts.formatDate(timestamp, charTimeZone)
        : undefined;
      return {
        ...(at ? { at } : {}),
        speaker: m.speaker.role === 'owner' ? char.name : contact.name,
        text: m.text.slice(0, 500),
      };
    });
    const lastMessage = historyMessages[historyMessages.length - 1];
    const lastMessageAt = typeof lastMessage?.createdAt === 'number' && Number.isFinite(lastMessage.createdAt)
      ? lastMessage.createdAt
      : thread?.time;
    const lastMessageContext = timeAwarenessOn && typeof lastMessageAt === 'number' && Number.isFinite(lastMessageAt)
      ? `${ChatPrompts.formatDate(lastMessageAt, charTimeZone)}，距今约${formatPhoneElapsed(now - lastMessageAt)}`
      : '没有可用时间戳；不要猜测距离上次联系多久。';
    const events = readCharacterLifeEvents(char.id)
      .filter(e => e.occurredAt <= now)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 9)
      .map(e => ({
        ...(timeAwarenessOn ? { time: ChatPrompts.formatDate(e.occurredAt, charTimeZone) } : {}),
        text: e.summary.slice(0, 140),
      }));
    const speakerName = actor === 'owner' ? char.name : contact.name;
    const chatsClearRevision = readPhoneContentClearRevision(char.id, 'chats');
    const contactsClearRevision = readPhoneContentClearRevision(char.id, 'contacts');
    if (!stillAuthorized() || isCharacterPhoneRefreshing(char.id) ||
        isLocalChatLeaseActive(char.id)) return 'skipped';
    if (!reservePhoneApiBudget(char.id)) return 'skipped';
    state.attemptsToday++;
    writeState(char.id, state);
    const result = await queryJson(api, [
      { role: 'system', content: `你模拟一台虚构角色自己的微信手机，不能扮演User。
本轮只能由${speakerName}说话，发给${actor === 'owner' ? contact.name : char.name}，禁止替另一方同时回复。
Char原设：${[char.name, char.systemPrompt, char.worldview].filter(Boolean).join('\\n').slice(0, 4200)}
角色相关世界书：${(char.mountedWorldbooks || []).filter(w => (w as typeof w & { enabled?: boolean }).enabled !== false).map(w => w.title + '：' + w.content).join('\\n').slice(0, 2200)}
角色当前时间与时间感知：${timeContextText}
联系人固定档案：${JSON.stringify(contact).slice(0, 1800)}
当前日程计划（仅是计划，不是已发生事件）：${life.plannedActivity || '无'}，${life.plannedDescription || ''}。
最近一条微信时间：${lastMessageContext}
已经保存的生活经历：${JSON.stringify(events).slice(0, 2100)}
此前双方真实保存的微信对话（如有时间戳，则为角色本地时间）：${JSON.stringify(history).slice(0, 2800)}
这是${why === 'unanswered' ? '回复对方留下的未回复消息，直接回应原话' : why === 'new-contact' ? '与最近建立联系的人自然开场，不得假装已有共同经历' : '延续双方已经保存的对话，跟进未完话题'}。
【选题与时间规则】先看角色当前本地时间、日程计划、已发生的生活经历和双方最近消息。优先回复未答消息或延续已有话题；不要按固定循环随机换联系人/话题、重复寒暄或凭空编造刚发生的事。不能把日程计划当成已发生事件。没有自然契机时必须选择send:false。
人物语言应有个人习惯，允许嘴硬、冷淡、敷衍、吐槽和忙碌。
不保证任何人随时有空，不得每轮互夸；不制造未经确认的现实事件或新的关系。
最多发送1至3条短微信气泡，若不想说话选择send:false。不可写User发言。
仅输出JSON：{"send":true,"messages":["消息1","消息2"]}或{"send":false,"messages":[]}。不得生成双方完整对话。` },
      { role: 'user', content: '由这位角色自主决定是否给对方发微信。' },
    ], char.id, '后台微信自然对话');
    const textMessages: string[] = Array.isArray(result?.messages)
      ? result.messages.filter((m: unknown): m is string => typeof m === 'string' && !!m.trim()).slice(0, 3)
      : [];
    if (result?.send !== true || !textMessages.length) return 'skipped';
    // A slow completion is not authority to overwrite changes made while it
    // was in flight. User may have disabled autonomy, cleared the inbox,
    // removed the contact, or manually replied in this same conversation.
    if (!stillAuthorized() ||
        isLocalChatLeaseActive(char.id) ||
        chatsClearRevision !== readPhoneContentClearRevision(char.id, 'chats') ||
        contactsClearRevision !== readPhoneContentClearRevision(char.id, 'contacts') ||
        isCharacterPhoneRefreshing(char.id) ||
        !readNpcProfiles(char.id).some(p => p.id === contact.id)) return 'skipped';
    const latestThread = readCharacterPhoneChats(char.id).find(r => r.contactId === contact.id);
    const baselineLength = thread?.messages.length || 0;
    const baselineLast = thread?.messages[baselineLength - 1];
    const latestLast = latestThread?.messages[(latestThread.messages.length || 1) - 1];
    if ((latestThread?.messages.length || 0) !== baselineLength ||
        (!!thread && latestThread?.id !== thread.id) ||
        (baselineLast?.createdAt || 0) !== (latestLast?.createdAt || 0) ||
        (baselineLast?.speaker.role || '') !== (latestLast?.speaker.role || '') ||
        (baselineLast?.text || '') !== (latestLast?.text || '')) return 'skipped';
    // A single actor per autonomous window. Char and NPC never continuously
    // trigger one another in the same run.
    const speaker = actor === 'owner' ? { role: 'owner' as const } : { role: 'contact' as const, contactId: contact.id };
    const added = appendCharacterPhoneMessages({
      characterId: char.id, contactId: contact.id,
      contactName: contact.remark || contact.nickname || contact.name,
      messages: textMessages.map(text => ({ speaker, text: text.trim().slice(0, 450) })),
      at: Date.now(),
    });
    if (!added?.added.length) return 'skipped';
    const occurredAt = Date.now();
    const latestState = readState(char.id, occurredAt);
    latestState.turnsToday++;
    latestState.contactAt[contact.id] = occurredAt;
    writeState(char.id, latestState);
    noteNpcInteraction(char.id, contact.id, occurredAt, added.added);
    recordCharacterLifeEvent({
      id: 'npc-chat:auto:' + added.thread.id + ':' + occurredAt,
      characterId: char.id, kind: 'npc-chat', occurredAt,
      source: 'phone', contactId: contact.id, phoneThreadId: added.thread.id,
      summary: (actor === 'owner' ? char.name + '主动给' + contact.name + '发微信：'
        : '收到' + contact.name + '的微信消息：') + added.added.map(m => m.text).join('；').slice(0, 1000),
    });
    return 'messaged';
  } catch (error) {
    console.warn('[PhoneAutonomy] background NPC turn failed', error);
    return 'failed';
  } finally { locks.delete(char.id); }
}
