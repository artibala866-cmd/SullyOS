/** A tiny per-Char invalidation marker for in-flight autonomous phone writes.
 * Clearing an already empty list must still invalidate any pending AI result.
 * This is not a replacement data store or an autonomous scheduler.
 */
export type PhoneContentClearKind = 'moments' | 'memos' | 'chats' | 'contacts' | 'payments';
const key = (characterId: string, kind: PhoneContentClearKind) =>
  'sully_phone_content_clear_revision_v1:' + characterId + ':' + kind;
// Storage can be full exactly when the User needs the clear button most.
// The in-tab fallback must never prevent that clear from freeing space.
const inMemoryRevisions = new Map<string, number>();

export function readPhoneContentClearRevision(characterId: string, kind: PhoneContentClearKind): number {
  if (!characterId) return 0;
  const name = key(characterId, kind);
  const fallback = inMemoryRevisions.get(name) || 0;
  try {
    const value = Number(localStorage.getItem(name) || 0);
    return Number.isSafeInteger(value) && value >= 0 ? Math.max(fallback, value) : fallback;
  } catch { return fallback; }
}

/** Advance before removing data; if storage is full, keep the in-tab protection. */
export function advancePhoneContentClearRevision(characterId: string, kind: PhoneContentClearKind): void {
  if (!characterId) return;
  const name = key(characterId, kind);
  const previous = readPhoneContentClearRevision(characterId, kind);
  const next = previous >= Number.MAX_SAFE_INTEGER ? 1 : previous + 1;
  inMemoryRevisions.set(name, next);
  try { localStorage.setItem(name, String(next)); }
  catch { /* A full store must not break the User's explicit clear action. */ }
}
