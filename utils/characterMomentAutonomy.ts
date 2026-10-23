import { readCharacterLifeEvents, type CharacterLifeEvent } from './characterLifeEvents';
import { publishCharacterMoment, readCharacterMoments } from './characterPhoneMoments';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { getDailyScheduleForChar } from './dailySchedule';
import { getCurrentScheduleSlotIndex } from './scheduleTime';
import { recordCharacterLifeEvent } from './characterLifeEvents';
import { safeResponseJson, extractContent } from './safeApi';
import type { CharacterProfile, UserProfile, GroupProfile, RealtimeConfig } from '../types';

type DialogueApi = { baseUrl: string; apiKey: string; model: string };
type Decision = 'posted' | 'skipped' | 'cooldown' | 'unavailable';
const STATE_PREFIX = 'sully_moment_autonomy_v1:';
const MIN_DECISION_GAP = 6 * 60 * 60 * 1000;
const MIN_POST_GAP = 12 * 60 * 60 * 1000;
const EVENT_MAX_AGE = 72 * 60 * 60 * 1000;
const locks = new Set<string>();
const validKinds = new Set<CharacterLifeEvent['kind']>(['npc-chat', 'market-purchase', 'proactive-message', 'activity']);

export interface MomentAutonomyState { lastDecisionAt: number; lastPostAt: number; seenEventIds: string[] }
function readState(id: string): MomentAutonomyState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_PREFIX + id) || '{}');
    return {
      lastDecisionAt: Number.isFinite(raw.lastDecisionAt) ? raw.lastDecisionAt : 0,
      lastPostAt: Number.isFinite(raw.lastPostAt) ? raw.lastPostAt : 0,
      seenEventIds: Array.isArray(raw.seenEventIds) ? raw.seenEventIds.filter((x: unknown): x is string => typeof x === 'string').slice(-300) : []
    };
  } catch { return { lastDecisionAt: 0, lastPostAt: 0, seenEventIds: [] }; }
}
function writeState(id: string, state: MomentAutonomyState): boolean {
  try { localStorage.setItem(STATE_PREFIX + id, JSON.stringify(state)); return true; } catch { return false; }
}
export function getMomentAutonomyCandidates(characterId: string, now = Date.now()): CharacterLifeEvent[] {
  const state = readState(characterId);
  const posted = new Set(readCharacterMoments(characterId).flatMap(p => p.provenance?.eventIds || []));
  return readCharacterLifeEvents(characterId).filter(e =>
    validKinds.has(e.kind) && e.occurredAt <= now && now - e.occurredAt < EVENT_MAX_AGE
    && !state.seenEventIds.includes(e.id) && !posted.has(e.id)
  ).slice(0, 8);
}

/** Invoked only when a real life event is recorded, not by opening the Moments page.
 * No fresh event means no AI call. A rejection also consumes its candidate events.
 */
export async function considerAutonomousMoment(input: {
  char: CharacterProfile;
  user: UserProfile;
  groups: GroupProfile[];
  api: DialogueApi;
  realtimeConfig?: RealtimeConfig;
  now?: number;
}): Promise<Decision> {
  const { char, user, groups, api, realtimeConfig } = input;
  const id = char.id;
  const now = input.now ?? Date.now();
  if (!id || locks.has(id)) return 'cooldown';
  if (!api.baseUrl || !api.apiKey || !api.model) return 'unavailable';
  const events = getMomentAutonomyCandidates(id, now);
  if (!events.length) return 'skipped';
  const state = readState(id);
  if ((state.lastDecisionAt && now - state.lastDecisionAt < MIN_DECISION_GAP) ||
      (state.lastPostAt && now - state.lastPostAt < MIN_POST_GAP)) return 'cooldown';
  const old = readCharacterMoments(id);
  if (old.some(p => now - p.createdAt >= 0 && now - p.createdAt < MIN_POST_GAP)) return 'cooldown';
  locks.add(id);
  try {
    // Reserve this opportunity before network calls. Failures still obey a cooldown.
    if (!writeState(id, { ...state, lastDecisionAt: now })) return 'unavailable';
    const context = await buildCharacterPhoneContext(char, user, groups, realtimeConfig);
    const schedule = await getDailyScheduleForChar(char);
    const slot = schedule?.slots[getCurrentScheduleSlotIndex(schedule.slots, char)];
    const scheduleHint = slot ? `日程状态：${slot.activity}，仅为计划，绝不视作已完成事件。` : '没有已确认的当日日程。';
    const recent = old.slice(0, 6).map(p => ({ text: p.text.slice(0, 160), deleted: !!p.deletedAt }));
    const response = await fetch(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, stream: false, messages: [
        { role: 'system', content: `你是${char.name}的朋友圈自主决策。基于角色原本人设、世界书、真实私聊与已记录事件决定是否发一条纯文字朋友圈。可以不发；不要迎合User。不要把日程、推测、AI先前写过的朋友圈当成真实发生的事，也不要伪造照片和聊天截图。${scheduleHint}真实上下文：${context.systemPrompt.slice(0, 24000)}。新增已发生生活事件：${JSON.stringify(events).slice(0, 5500)}。近期朋友圈：${JSON.stringify(recent)}。只能引用给出的事件ID；若没有值得发的内容请选择publish:false。必须只返回JSON：{"publish":false,"text":"","eventIds":[]}或{"publish":true,"text":"朋友圈正文","eventIds":["真实事件ID"]}。` },
        { role: 'user', content: '这是角色自己的生活，不是给User的回复。请决定发还是不发。' }
      ] })
    });
    const json = await safeResponseJson(response);
    if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
    const raw = extractContent(json).trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/, '');
    const data: unknown = JSON.parse(raw);
    const parsed = data as { publish?: unknown; text?: unknown; eventIds?: unknown };
    const ids = Array.isArray(parsed.eventIds)
      ? [...new Set(parsed.eventIds.filter((v): v is string => typeof v === 'string' && events.some(e => e.id === v)))]
      : [];
    // Whatever the answer, this set of events received its own decision.
    writeState(id, { ...readState(id), seenEventIds: [...new Set([...readState(id).seenEventIds, ...events.map(e => e.id)])].slice(-300) });
    if (parsed.publish !== true) return 'skipped';
    if (typeof parsed.text !== 'string' || !parsed.text.trim() || !ids.length) return 'skipped';
    const post = publishCharacterMoment({
      characterId: id, origin: 'char', text: parsed.text.trim().slice(0, 2000),
      imageUrls: [], visibility: 'all', provenance: { eventIds: ids, decision: 'event-triggered' }
    });
    if (!post) return 'skipped';
    writeState(id, { ...readState(id), lastPostAt: post.createdAt });
    recordCharacterLifeEvent({
      id: 'moment:' + post.id, characterId: id, kind: 'moment-post',
      occurredAt: post.createdAt, source: 'phone',
      summary: 'Char 自主发布朋友圈：' + post.text.slice(0, 100)
    });
    return 'posted';
  } catch (error) {
    console.warn('[CharacterMoments] autonomous decision failed', error);
    return 'unavailable';
  } finally { locks.delete(id); }
}
