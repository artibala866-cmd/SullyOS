import type { CharacterLifeEvent, CharacterLifeEventKind } from './characterLifeEvents';

/** Pure routing policy: an event is a confirmed fact, never a planned schedule slot.
 * Keep producers and app-specific AI decisions separate. No timers or API calls here.
 */
export type LifeEventConsumer = 'moments' | 'memo';
const ROUTES: Partial<Record<CharacterLifeEventKind, readonly LifeEventConsumer[]>> = {
  'npc-chat': ['moments', 'memo'],
  'market-purchase': ['moments', 'memo'],
  'proactive-message': ['moments', 'memo'],
  'activity': ['moments', 'memo'],
  'contact-added': ['memo'],
  'moment-comment': [],
  'moment-post': [],
};
export function getLifeEventConsumers(kind: CharacterLifeEventKind): readonly LifeEventConsumer[] {
  return ROUTES[kind] ?? [];
}
export function shouldDispatchLifeEvent(
  event: Pick<CharacterLifeEvent, 'characterId' | 'kind' | 'occurredAt' | 'summary'>,
  characterId: string,
  now = Date.now(),
): boolean {
  return !!characterId && event.characterId === characterId &&
    !!event.summary.trim() && Number.isFinite(event.occurredAt) &&
    event.occurredAt <= now && now - event.occurredAt < 72 * 60 * 60 * 1000 &&
    getLifeEventConsumers(event.kind).length > 0;
}
