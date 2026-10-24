/**
 * Phone refresh tracker, adapted to SullyOS's existing local inbox.
 * The task identity lives at module scope so closing/reopening the phone
 * cannot launch duplicate LLM requests or lose "refreshing" UI state.
 * No new data store or parallel check-phone subsystem.
 */
const pending = new Set<string>();
export const CHARACTER_PHONE_REFRESH_CHANGED = 'sully:character-phone-refresh-changed';

const refreshKey = (characterId: string, feature: 'wechat' | 'moments') =>
  characterId + ':' + feature;

export function isCharacterPhoneRefreshing(
  characterId: string, feature: 'wechat' | 'moments' = 'wechat',
): boolean {
  return pending.has(refreshKey(characterId, feature));
}

export function beginCharacterPhoneRefresh(
  characterId: string, feature: 'wechat' | 'moments' = 'wechat',
): boolean {
  if (!characterId) return false;
  const key = refreshKey(characterId, feature);
  if (pending.has(key)) return false;
  pending.add(key);
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_REFRESH_CHANGED,
      { detail: { characterId, feature, running: true } }));
  return true;
}

export function finishCharacterPhoneRefresh(
  characterId: string, feature: 'wechat' | 'moments' = 'wechat',
): void {
  if (!pending.delete(refreshKey(characterId, feature))) return;
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(CHARACTER_PHONE_REFRESH_CHANGED,
      { detail: { characterId, feature, running: false } }));
}
