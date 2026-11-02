import type { CharacterProfile } from '../types';
import { readCharacterLifeEvents, type CharacterLifeEvent } from './characterLifeEvents';
import { resolveCharTimeZone } from './timezone';

/** Shared read-only facts. A stored phone story is role-world history, never a new task. */
export function buildCharacterLifeFacts(
  char: Pick<CharacterProfile, 'id' | 'customTimezoneEnabled' | 'customTimezone' | 'timeAwarenessEnabled'>,
  options: { now?: number; sources?: CharacterLifeEvent['source'][]; events?: CharacterLifeEvent[] } = {},
): string {
  const now = options.now ?? Date.now();
  const events = (options.events ?? readCharacterLifeEvents(char.id))
    .filter(e => e.characterId === char.id && Number.isFinite(e.occurredAt) &&
      e.occurredAt <= now && now - e.occurredAt < 72 * 3600_000 &&
      (!options.sources || options.sources.includes(e.source)))
    .sort((a,b) => b.occurredAt - a.occurredAt).slice(0,12);
  if (!events.length) return '';
  const zone = resolveCharTimeZone(char);
  const timestamp = (at: number) => char.timeAwarenessEnabled === false ? '' :
    new Date(at).toLocaleString('zh-CN', { ...(zone ? {timeZone:zone} : {}), hour12:false }) + ' ';
  return '\n【角色世界内已保存的近期经历】\n' + events.map(e =>
    '- ' + timestamp(e.occurredAt) + e.summary.slice(0,200)).join('\n') +
    '\n这些是已保存的角色经历，不是计划、待办或必须汇报的话题；手机故事不证明现实世界事件。以眼前对话为主，不补造未记录细节，不因旧经历反复联系 User。\n';
}
