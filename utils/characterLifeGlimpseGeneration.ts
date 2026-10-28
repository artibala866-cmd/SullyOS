/**
 * Independent, explicitly opt-in life-glimpse narration.
 * This module never enters private-chat prompt building, message persistence,
 * NPC contact generation, AMSG, or the autonomous phone scheduler.
 * The factual life-event ledger remains authoritative; the AI text is a
 * separately labelled interpretation attached to one confirmed event.
 */
import type { CharacterProfile } from '../types';
import { readCharacterLifeEvents, attachCharacterLifeGlimpse, type CharacterLifeEvent } from './characterLifeEvents';
import { readNpcProfiles } from './characterPhoneNpcs';
import { resolveCharTimeZone } from './timezone';
import { fetchCharacterPhoneJson } from './characterPhoneAiRequest';
import { extractContent } from './safeApi';
import type { PhoneDialogueApi } from './characterPhoneApiConfig';

const KEY = (id: string) => 'sully_life_glimpse_manual_ai_v1:' + id;
export const LIFE_GLIMPSE_PREFERENCE_CHANGED = 'sully:life-glimpse-preference-changed';

export function isManualLifeGlimpseEnabled(characterId: string): boolean {
  if (!characterId || typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(KEY(characterId)) === '1'; } catch { return false; }
}

export function setManualLifeGlimpseEnabled(characterId: string, enabled: boolean): void {
  if (!characterId || typeof localStorage === 'undefined') return;
  if (enabled) localStorage.setItem(KEY(characterId), '1');
  else localStorage.removeItem(KEY(characterId));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(
    LIFE_GLIMPSE_PREFERENCE_CHANGED, { detail: { characterId, enabled } }));
}

export function buildIndependentLifeGlimpseRequest(
  char: CharacterProfile,
  event: CharacterLifeEvent,
  recentFacts: readonly CharacterLifeEvent[],
  contact?: { name: string; relationship: string } | null,
): Array<{ role: 'system' | 'user'; content: string }> {
  const zone = resolveCharTimeZone(char);
  let occurredAt = new Date(event.occurredAt).toLocaleString('zh-CN');
  if (zone) {
    try { occurredAt = new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: zone }); }
    catch { /* Invalid custom timezone: preserve the absolute timestamp in local time. */ }
  }
  const characterContext = [
    char.name,
    char.systemPrompt || '',
    char.worldview || '',
  ].join('\n').slice(0, 9000);
  const confirmed = recentFacts.filter(f => f.characterId === char.id &&
    f.id !== event.id && f.occurredAt <= event.occurredAt &&
    Number.isFinite(f.occurredAt)).slice(0, 6).map(f => ({
    at: f.occurredAt, kind: f.kind, source: f.source, fact: f.summary.slice(0, 180),
  }));
  return [
    { role: 'system', content: `你是虚构人物的独立生活侧面记录器，不是私聊回复器。
这一轮只写一条已确认生活事件的主观生活侧面，不能发给 User，也不能发 NPC 微信。
角色原设仅用于维持身份和个人口吻；它不授权你修改人物原设或原有私聊规则。
【角色原设（只读）】\n${characterContext}
【硬边界】事件摘要与时间是唯一已确认的本次事实。不得虚构新的行动、地点、真实对话、收支、关系变化或约定，不得把日程计划当作发生的事。
允许写符合人物性格的微小心理感受或对已确认事实的观察，但不能把推测包装成已发生事实，也不能把所有事件都写成温柔的、积极的。
没有可自然展开的细节就返回 {"skip":true,"text":""}；不强求每件事有故事。
有内容时只返回 JSON {"skip":false,"text":"一段简短自然的生活侧面"}，50～260字，不要台账、标题、指令、时间标签或聊天气泡。不要自创第二条事件。` },
    { role: 'user', content: JSON.stringify({
      kind: 'confirmed-life-event', eventId: event.id, occurredAt,
      source: event.source, eventKind: event.kind, confirmedFact: event.summary.slice(0, 650),
      contact: contact ? { name: contact.name, relationship: contact.relationship } : null,
      earlierConfirmedFacts: confirmed,
    }) },
  ];
}

export async function generateIndependentLifeGlimpse(input: {
  char: CharacterProfile;
  event: CharacterLifeEvent;
  api: PhoneDialogueApi;
  signal?: AbortSignal;
}): Promise<'saved' | 'skipped'> {
  const { char, event, api, signal } = input;
  if (!char?.id || char.id !== event.characterId || signal?.aborted ||
      !isManualLifeGlimpseEnabled(char.id) ||
      !Number.isFinite(event.occurredAt) || event.occurredAt <= 0 ||
      event.occurredAt > Date.now()) return 'skipped';
  if (!/^https?:\/\//i.test(api.baseUrl) || !api.apiKey || !api.model)
    throw new Error('请先配置可用的对话 API，再手动展开生活片段');
  // Snapshot must still exist unchanged before sending a potentially billed request.
  const known = readCharacterLifeEvents(char.id);
  if (!known.some(f => f.id === event.id && f.summary === event.summary &&
      f.occurredAt === event.occurredAt && f.source === event.source)) return 'skipped';
  const contact = event.contactId
    ? readNpcProfiles(char.id).find(n => n.id === event.contactId) : undefined;
  const messages = buildIndependentLifeGlimpseRequest(char, event, known, contact);
  const { response, json } = await fetchCharacterPhoneJson(
    api.baseUrl.replace(/\/+$/, '') + '/chat/completions',
    { method: 'POST', signal, headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + api.apiKey,
    }, body: JSON.stringify({ model: api.model, stream: false, temperature: 0.6, messages }) },
    { charId: char.id, purpose: '用户手动展开已确认生活侧面', automatic: false },
  );
  if (!response.ok) throw new Error(json?.error?.message || '生活片段生成请求失败（HTTP ' + response.status + '）');
  const raw = String(extractContent(json) || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('生活侧面没有返回有效 JSON，本次不写入任何事实'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'skipped';
  const result = parsed as { skip?: unknown; text?: unknown };
  if (result.skip === true) return 'skipped';
  const narrative = typeof result.text === 'string' ? result.text.trim() : '';
  if (narrative.length < 8 || narrative.length > 1000) return 'skipped';
  // No new record is created; clearing or editing the original event during
  // the API call invalidates this exact snapshot. Disabling the toggle aborts.
  if (signal?.aborted || !isManualLifeGlimpseEnabled(char.id)) return 'skipped';
  return attachCharacterLifeGlimpse(event, narrative) ? 'saved' : 'skipped';
}
