import { readCharacterLifeEvents, type CharacterLifeEvent } from './characterLifeEvents';
import { publishCharacterMoment, readCharacterMoments } from './characterPhoneMoments';
import { buildCharacterPhoneContext } from './characterPhoneContext';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';
import { recordCharacterLifeEvent } from './characterLifeEvents';
import { extractContent } from './safeApi';
import { fetchCharacterPhoneJson } from './characterPhoneAiRequest';
import { canUsePhoneApiBudget, reservePhoneApiBudget, readPhoneAutonomyPreferences } from './characterPhoneApiBudget';
import { isCharacterPhoneAutonomyEnabled } from './characterPhoneAutonomy';
import { readPhoneContentClearRevision } from './characterPhoneContentClearRevision';
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
  /** Autonomous reactions to Char-phone events consume the shared budget. */
  budgeted?: boolean;
}): Promise<Decision> {
  const { char, user, groups, api, realtimeConfig } = input;
  const id = char.id;
  const now = input.now ?? Date.now();
  const clearRevision = readPhoneContentClearRevision(id, 'moments');
  if (!id || locks.has(id)) return 'cooldown';
  if (!isCharacterPhoneAutonomyEnabled(id) || !readPhoneAutonomyPreferences(id).backgroundApiEnabled) return 'unavailable';
  if (!api.baseUrl || !api.apiKey || !api.model) return 'unavailable';
  if (input.budgeted && !canUsePhoneApiBudget(id)) return 'cooldown';
  const events = getMomentAutonomyCandidates(id, now);
  if (!events.length) return 'skipped';
  const state = readState(id);
  if ((state.lastDecisionAt && now - state.lastDecisionAt < MIN_DECISION_GAP) ||
      (state.lastPostAt && now - state.lastPostAt < MIN_POST_GAP)) return 'cooldown';
  const old = readCharacterMoments(id);
  if (old.some(p => now - p.createdAt >= 0 && now - p.createdAt < MIN_POST_GAP)) return 'cooldown';
  locks.add(id);
  try {
    // A failed local context preparation must not occupy six hours of
    // decisions or spend a paid quota. Hold the in-memory lock meanwhile.
    const context = await buildCharacterPhoneContext(char, user, groups, realtimeConfig);
    const life = await getCharacterLifeScheduleContext(char, new Date(now));
    const scheduleHint = life.plannedActivity
      ? `当前计划：${life.plannedActivity}${life.plannedDescription ? '（' + life.plannedDescription + '）' : ''}。这只是计划，不能当作已发生事实。`
      : '当前没有可用的日程计划。';
    const recent = old.slice(0, 6).map(p => ({ text: p.text.slice(0, 160), deleted: !!p.deletedAt }));
    // Settings and evidence can change while the context is being assembled.
    // Never make a stale paid decision after the user has switched autonomy off
    // or cleared the event which would have justified the post.
    if (!isCharacterPhoneAutonomyEnabled(id) ||
        !readPhoneAutonomyPreferences(id).backgroundApiEnabled ||
        readPhoneContentClearRevision(id, 'moments') !== clearRevision) return 'unavailable';
    const currentEventIds = new Set(getMomentAutonomyCandidates(id, Date.now()).map(e => e.id));
    if (!events.some(e => currentEventIds.has(e.id))) return 'skipped';
    if (!writeState(id, { ...readState(id), lastDecisionAt: now })) return 'unavailable';
    if (input.budgeted && !reservePhoneApiBudget(id)) return 'cooldown';
    const { response, json } = await fetchCharacterPhoneJson(api.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey },
      body: JSON.stringify({ model: api.model, stream: false, messages: [
        { role: 'system', content: `你是${char.name}的朋友圈自主决策。基于角色原本人设、世界书、真实私聊与已记录事件决定是否发一条纯文字朋友圈。可以不发；不要迎合User。不要把日程、推测、AI先前写过的朋友圈当成真实发生的事，也不要伪造照片和聊天截图。${scheduleHint}真实上下文：${context.systemPrompt.slice(0, 11000)}。已确认生活事实（仅作连续性背景，不得扩大为未发生的经历）：${JSON.stringify(life.confirmedEvents.slice(0, 12)).slice(0, 3500)}。本次可引用的新增真实事件：${JSON.stringify(events).slice(0, 3000)}。近期朋友圈：${JSON.stringify(recent)}。只能引用给出的事件ID；若没有值得发的内容请选择publish:false。必须只返回JSON：{"publish":false,"text":"","eventIds":[]}或{"publish":true,"text":"朋友圈正文","eventIds":["真实事件ID"]}。` },
        { role: 'user', content: '这是角色自己的生活，不是给User的回复。请决定发还是不发。' }
      ] })
    }, { charId: id, purpose: '生活事件触发朋友圈决策', automatic: true });
    if (!response.ok) throw new Error(json?.error?.message || 'HTTP ' + response.status);
    const raw = extractContent(json).trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/\s*`{3}$/, '');
    const data: unknown = JSON.parse(raw);
    const parsed = data as { publish?: unknown; text?: unknown; eventIds?: unknown };
    // The model may finish after a setting change, phone cleanup or an
    // independently saved post. Never resurrect cleared facts or publish late.
    if (!isCharacterPhoneAutonomyEnabled(id) ||
        !readPhoneAutonomyPreferences(id).backgroundApiEnabled ||
        readPhoneContentClearRevision(id, 'moments') !== clearRevision) return 'skipped';
    const freshCandidates = new Set(getMomentAutonomyCandidates(id, Date.now()).map(e => e.id));
    if (!events.some(e => freshCandidates.has(e.id))) return 'skipped';
    if (readCharacterMoments(id).some(p => !p.deletedAt && Date.now() - p.createdAt >= 0 &&
        Date.now() - p.createdAt < MIN_POST_GAP)) return 'skipped';
    const ids = Array.isArray(parsed.eventIds)
      ? [...new Set(parsed.eventIds.filter((v): v is string => typeof v === 'string' && events.some(e => e.id === v) && freshCandidates.has(v)))]
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
