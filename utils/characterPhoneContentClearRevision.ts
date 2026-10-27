/** A tiny per-Char invalidation marker for in-flight autonomous phone writes.
 * Clearing an already empty list must still invalidate any pending AI result.
 * This is not a replacement data store or an autonomous scheduler.
 */
export type PhoneContentClearKind = 'moments' | 'memos';
const key = (characterId: string, kind: PhoneContentClearKind) =>
  'sully_phone_content_clear_revision_v1:' + characterId + ':' + kind;

export function readPhoneContentClearRevision(characterId: string, kind: PhoneContentClearKind): number {
  if (!characterId || typeof localStorage === 'undefined') return 0;
  try {
    const value = Number(localStorage.getItem(key(characterId, kind)) || 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}

/** Advance before removing data so a failed or delayed generation knows a clear was requested. */
export function advancePhoneContentClearRevision(characterId: string, kind: PhoneContentClearKind): void {
  if (!characterId) return;
  const previous = readPhoneContentClearRevision(characterId, kind);
  const next = previous >= Number.MAX_SAFE_INTEGER ? 1 : previous + 1;
  localStorage.setItem(key(characterId, kind), String(next));
}
