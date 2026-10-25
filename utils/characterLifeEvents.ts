/** Character-phone life event ledger.
 * An event records an action that actually happened; reading never invents activity.
 * Shared by the phone UI and future real-mode / AMSG 2.0 producers.
 */
export type CharacterLifeEventKind = 'npc-chat' | 'contact-added' | 'moment-post' | 'moment-comment' | 'market-purchase' | 'proactive-message' | 'activity' | 'browser-search';
export interface CharacterLifeEvent {
  id: string;
  characterId: string;
  kind: CharacterLifeEventKind;
  occurredAt: number;
  source: 'phone' | 'real-mode' | 'amsg2' | 'chat' | 'xiaohongshu';
  summary: string;
  contactId?: string;
  relatedMessageId?: string;
}
export const CHARACTER_LIFE_EVENTS_CHANGED = 'sully:character-life-events-changed';
export const lifeEventStorageKey = (characterId: string) => 'sully_character_life_events_v1:' + characterId;
export function readCharacterLifeEvents(characterId: string): CharacterLifeEvent[] {
  if (!characterId || typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(lifeEventStorageKey(characterId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((e): e is CharacterLifeEvent =>
      !!e && typeof e.id === 'string' && e.characterId === characterId &&
      typeof e.kind === 'string' && typeof e.occurredAt === 'number' && typeof e.summary === 'string')
      .sort((a, b) => b.occurredAt - a.occurredAt) : [];
  } catch { return []; }
}
export function recordCharacterLifeEvent(event: CharacterLifeEvent): boolean {
  if (!event.characterId || !event.id || !Number.isFinite(event.occurredAt) || !event.summary.trim()) return false;
  const old = readCharacterLifeEvents(event.characterId);
  if (old.some(e => e.id === event.id)) return false;
  const updated = [event, ...old].sort((a,b) => b.occurredAt - a.occurredAt).slice(0, 500);
  try { localStorage.setItem(lifeEventStorageKey(event.characterId), JSON.stringify(updated)); }
  catch { return false; }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHARACTER_LIFE_EVENTS_CHANGED, { detail: { characterId: event.characterId, eventId: event.id } }));
  return true;
}

/** Only remove temporary phone-event context for categories the user explicitly cleared.
 * Do NOT erase other real-mode/XHS events or previously archived Memory Palace data.
 */
export function pruneCharacterPhoneLifeEvents(
  characterId:string,
  kinds:readonly CharacterLifeEventKind[],
):number {
  if(!characterId||!kinds.length||typeof localStorage==='undefined')return 0;
  const allowed=new Set(kinds);
  const old=readCharacterLifeEvents(characterId);
  const remaining=old.filter(e=>!(e.source==='phone'&&allowed.has(e.kind)));
  if(remaining.length===old.length)return 0;
  localStorage.setItem(lifeEventStorageKey(characterId),JSON.stringify(remaining));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(
    CHARACTER_LIFE_EVENTS_CHANGED,{detail:{characterId,pruned:true}}));
  return old.length-remaining.length;
}
