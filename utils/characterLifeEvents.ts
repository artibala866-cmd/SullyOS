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
  /** Id of persisted NPC WeChat thread; lets the user revoke its life-context snapshots. */
  phoneThreadId?: string;
  /** Optional narrative reflection about this *same* confirmed fact. Not a new fact. */
  glimpse?: { text: string; generatedAt: number; anchorSummary: string };
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

/** Revoke only confirmed phone NPC-chat facts when a saved WeChat thread
 * is explicitly deleted. Legacy event IDs encoded the stable thread id;
 * contactId handles older records without an explicit phoneThreadId.
 * Memory Palace and real private-chat records remain untouched.
 */
export function pruneDeletedPhoneChatLifeEvents(characterId:string,thread:{
  id:string;contactId?:string;
}):number{
  if(!characterId||!thread.id||typeof localStorage==='undefined')return 0;
  const before=readCharacterLifeEvents(characterId);
  const after=before.filter(event=>{
    if(event.source!=='phone'||event.kind!=='npc-chat')return true;
    if(event.phoneThreadId)return event.phoneThreadId!==thread.id;
    const ids=['npc-chat:'+thread.id+':','npc-chat:inbox:'+thread.id+':',
      'npc-chat:auto:'+thread.id+':'];
    return !ids.some(prefix=>event.id.startsWith(prefix))&&
      (!thread.contactId||event.contactId!==thread.contactId);
  });
  if(after.length===before.length)return 0;
  localStorage.setItem(lifeEventStorageKey(characterId),JSON.stringify(after));
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(
    CHARACTER_LIFE_EVENTS_CHANGED,{detail:{characterId,pruned:true,threadId:thread.id}}));
  return before.length-after.length;
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

/**
 * Attach an optional interpretation to an unchanged, already-confirmed event.
 * The ledger is the only storage. Never create a new event or alter its summary.
 * An explicit clear, manual edit, or competing generation invalidates the snapshot.
 */
export function attachCharacterLifeGlimpse(
  expected: CharacterLifeEvent,
  text: string,
  generatedAt = Date.now(),
): boolean {
  if (!expected.characterId || !expected.id || !text.trim() ||
      text.length > 1000 || !Number.isFinite(generatedAt)) return false;
  const latest = readCharacterLifeEvents(expected.characterId);
  const index = latest.findIndex(item => item.id === expected.id);
  if (index < 0) return false;
  const current = latest[index];
  if (current.occurredAt !== expected.occurredAt ||
      current.kind !== expected.kind || current.source !== expected.source ||
      current.summary !== expected.summary ||
      JSON.stringify(current.glimpse ?? null) !== JSON.stringify(expected.glimpse ?? null)) return false;
  const next = [...latest];
  next[index] = { ...current, glimpse: {
    text: text.trim(), generatedAt, anchorSummary: expected.summary,
  } };
  try { localStorage.setItem(lifeEventStorageKey(expected.characterId), JSON.stringify(next)); }
  catch { return false; }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(
    CHARACTER_LIFE_EVENTS_CHANGED,
    { detail: { characterId: expected.characterId, eventId: expected.id } },
  ));
  return true;
}
