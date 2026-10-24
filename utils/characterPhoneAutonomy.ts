import type { CharacterProfile, UserProfile, GroupProfile, RealtimeConfig } from '../types';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import { classifyLifeActivity } from './sullyLifeClock';
import { readCharacterLifeEvents, recordCharacterLifeEvent } from './characterLifeEvents';
import { readNpcProfiles, type NpcProfile } from './characterPhoneNpcs';
import { readPendingContacts } from './characterPhoneRequests';
import { registerDiscoveredNpc, noteNpcInteraction, type NpcDiscovery } from './characterNpcNetwork';
import { appendCharacterPhoneMessages, readCharacterPhoneChats, type CharacterPhoneChat } from './characterPhoneChats';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { safeResponseJson, extractContent } from './safeApi';
import { isCharacterPhoneRefreshing } from './characterPhoneRefreshTracker';
import { canUsePhoneApiBudget, reservePhoneApiBudget } from './characterPhoneApiBudget';

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
  window.dispatchEvent(new CustomEvent('sully:character-phone-autonomy-changed', { detail: { characterId: charId, enabled } }));
}
const SIX_HOURS = 6 * 3600000;
const DAY = 24 * 3600000;
const idHash = (value: string) => [...value].reduce((hash, c) => ((hash * 33) ^ c.charCodeAt(0)) >>> 0, 5381);

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
async function queryJson(api: Api, messages: { role: 'system' | 'user'; content: string }[]): Promise<any> {
  const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    signal: AbortSignal.timeout(60_000),
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
    body: JSON.stringify({ model: api.model, stream: false, temperature: 0.8, messages }),
  });
  const json = await safeResponseJson(response);
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
async function bootstrapSocialCircle(input: CharacterPhoneAutonomyInput): Promise<boolean> {
  const { char, user, groups, realtimeConfig, api } = input;
  const context = await buildCharacterPhoneContext(char, user, groups, realtimeConfig);
  const existing = readNpcProfiles(char.id);
  const pending = readPendingContacts(char.id);
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
  ]);
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
    if (result.status === 'added' || result.status === 'pending') created = true;
    if (result.status === 'added' && result.profile) recordCharacterLifeEvent({
      id: 'contact:' + result.profile.id, characterId: char.id, kind: 'contact-added',
      occurredAt: result.profile.createdAt, source: 'phone', contactId: result.profile.id,
      summary: '角色生活圈新增联系人：' + result.profile.name,
    });
  }
  return created;
}

type Decision = { contact: NpcProfile; thread?: CharacterPhoneChat; actor: 'owner' | 'contact'; why: string };
function chooseAction(charId: string, contacts: NpcProfile[], threads: CharacterPhoneChat[], state: RunState, now: number, busy: boolean): Decision | null {
  const available = contacts.filter(p => p.id !== charId && p.name && p.personality && p.source !== 'character');
  const priority: Decision[] = [];
  for (const contact of available) {
    const thread = threads.find(row => row.contactId === contact.id);
    const last = thread?.messages[thread.messages.length - 1];
    const lastContactAttempt = state.contactAt[contact.id] || 0;
    if (now - lastContactAttempt < 45 * 60_000) continue;
    // A message awaiting the owner's reply is a stronger opportunity than
    // manufactured chit-chat. Busy characters may delay replying.
    if (last?.speaker.role === 'contact' && now - (last.createdAt || thread!.time) > (busy ? 60 : 7) * 60_000) {
      priority.push({ contact, thread, actor: 'owner', why: 'unanswered' });
    }
  }
  if (priority.length) return priority.sort((a, b) =>
    (b.thread?.time || 0) - (a.thread?.time || 0))[0];
  // No proactive phone activity while busy. Reading a schedule never writes
  // a life event, and no message is generated just because a slot ends.
  if (!available.length) return null;
  const candidates = available.filter(contact => {
    const thread = threads.find(row => row.contactId === contact.id);
    const last = thread?.messages[thread.messages.length - 1];
    const recentAt = Math.max(thread?.time || 0, state.contactAt[contact.id] || 0);
    return (!last && now - (contact.createdAt || 0) > 5 * 60_000) ||
      (last?.speaker.role === 'owner' && now - recentAt > 4 * 3600000) ||
      (last?.speaker.role === 'contact' && now - recentAt > 5 * 3600000);
  });
  if (!candidates.length) return null;
  const index = (idHash(charId) + Math.floor(now / (3 * 3600000))) % candidates.length;
  const contact = candidates[index];
  const thread = threads.find(row => row.contactId === contact.id);
  const last = thread?.messages[thread.messages.length - 1];
  // Sometimes Char proactively contacts a friend; sometimes a friend reaches
  // out. Never treat a second fictional character as User.
  const actor: 'owner' | 'contact' = busy || !last ? 'contact'
    : (idHash(contact.id + Math.floor(now / DAY)) % 3 === 0 ? 'owner' : 'contact');
  return { contact, thread, actor, why: 'ordinary-life' };
}

export async function runCharacterPhoneAutonomy(input: CharacterPhoneAutonomyInput): Promise<PhoneAutonomyOutcome> {
  const { char, api } = input;
  if (!char?.id || !api?.apiKey || !api.baseUrl || !api.model ||
      typeof document === 'undefined' || document.visibilityState !== 'visible' ||
      !isCharacterPhoneAutonomyEnabled(char.id)) return 'unavailable';
  // User-triggered refresh/continuation owns the inbox while its LLM call is
  // in flight. Never start a competing background write in the same window.
  if (isCharacterPhoneRefreshing(char.id) || !canUsePhoneApiBudget(char.id)) return 'skipped';
  if (locks.has(char.id)) return 'skipped';
  locks.add(char.id);
  const now = Date.now();
  try {
    const state = readState(char.id, now);
    if (state.turnsToday >= 9 || state.attemptsToday >= 12 || now - state.lastAttemptAt < 18 * 60_000) return 'skipped';
    // Reserve the attempt BEFORE the network request. The app may be reopened or
    // multiple phone surfaces may ask for updates in the same time window.
    state.lastAttemptAt = now;
    writeState(char.id, state);
    let contacts = readNpcProfiles(char.id);
    if (contacts.length < 4 && now - state.bootstrapAt > DAY) {
      if (!reservePhoneApiBudget(char.id)) return 'skipped';
      state.bootstrapAt = now;
      state.attemptsToday++;
      writeState(char.id, state);
      try {
        if (await bootstrapSocialCircle(input)) return 'generated-contacts';
      } catch (error) { console.warn('[PhoneAutonomy] NPC bootstrap skipped', error); }
      contacts = readNpcProfiles(char.id);
    }
    if (!contacts.length) return 'skipped';
    const life = await getCharacterLifeScheduleContext(char, new Date(now));
    const busyStatus = classifyLifeActivity(char.scheduleFeatureEnabled === false ? '' : (life.plannedActivity || ''));
    if (busyStatus === 'sleep') return 'skipped';
    const threads = readCharacterPhoneChats(char.id);
    const decision = chooseAction(char.id, contacts, threads, state, now, busyStatus === 'busy');
    if (!decision) return 'skipped';
    const { contact, thread, actor } = decision;
    const history = (thread?.messages || []).slice(-16).map(m => ({
      speaker: m.speaker.role === 'owner' ? char.name : contact.name,
      text: m.text.slice(0, 500),
    }));
    const events = readCharacterLifeEvents(char.id)
      .filter(e => e.occurredAt <= now).slice(0, 9)
      .map(e => ({ time: e.occurredAt, text: e.summary.slice(0, 140) }));
    const speakerName = actor === 'owner' ? char.name : contact.name;
    if (!reservePhoneApiBudget(char.id)) return 'skipped';
    state.attemptsToday++;
    writeState(char.id, state);
    const result = await queryJson(api, [
      { role: 'system', content: `你模拟一台虚构角色自己的微信手机，不能扮演User。
本轮只能由${speakerName}说话，发给${actor === 'owner' ? contact.name : char.name}，禁止替另一方同时回复。
Char原设：${[char.name, char.systemPrompt, char.worldview].filter(Boolean).join('\n').slice(0, 4200)}
角色相关世界书：${(char.mountedWorldbooks || []).filter(w => w.enabled !== false).map(w => w.title + '：' + w.content).join('\n').slice(0, 2200)}
联系人固定档案：${JSON.stringify(contact).slice(0, 1800)}
当前日程计划（不是已发生事件）：${life.plannedActivity || '无'}，${life.plannedDescription || ''}。
已经保存的生活经历：${JSON.stringify(events).slice(0, 2100)}
此前双方真实保存的微信对话：${JSON.stringify(history).slice(0, 2800)}
这是${decision.why === 'unanswered' ? '对方留下了未回复消息，稍后自然回复' : '有合理契机的一次私人微信行为'}。
人物语言应有个人习惯，允许嘴硬、冷淡、敷衍、吐槽和忙碌。
不保证任何人随时有空，不得每轮互夸；不制造未经确认的现实事件或新的关系。
最多发送1至3条短微信气泡，若不想说话选择send:false。不可写User发言。
仅输出JSON：{"send":true,"messages":["消息1","消息2"]}或{"send":false,"messages":[]}。不得生成双方完整对话。 ` },
      { role: 'user', content: '由这位角色自主决定是否给对方发微信。' },
    ]);
    const textMessages = Array.isArray(result?.messages)
      ? result.messages.filter((m: unknown): m is string => typeof m === 'string' && !!m.trim()).slice(0, 3)
      : [];
    if (result?.send !== true || !textMessages.length) return 'skipped';
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
      source: 'phone', contactId: contact.id,
      summary: (actor === 'owner' ? char.name + '主动给' + contact.name + '发微信：'
        : '收到' + contact.name + '的微信消息：') + added.added.map(m => m.text).join('；').slice(0, 1000),
    });
    return 'messaged';
  } catch (error) {
    console.warn('[PhoneAutonomy] background NPC turn failed', error);
    return 'failed';
  } finally { locks.delete(char.id); }
}
