/** Single source of truth for real-person mode.
 * AMSG2 is the permission to contact User without a fresh user turn.
 * Private-chat automatic replies require explicit real-person permission.
 */
import type { CharacterProfile } from '../types';

export const REAL_PERSON_MODE_KEY = 'sully_life_pacing';
export const REAL_PERSON_MODE_CHANGED_EVENT = 'sully:real-person-mode-changed';
/** User-turn reply permission must not inherit the historical life-mode default. */
export const REAL_PERSON_AUTO_REPLY_CONSENT_KEY = 'sully_real_person_reply_explicit_v1';
export const CHAT_AUTO_REPLY_REVOKE_REVISION_KEY = 'sully_chat_auto_reply_revoke_revision_v1';

let localRevokeRevision = 0;
export function realPersonReplyRevision(): string {
  try { return localStorage.getItem(CHAT_AUTO_REPLY_REVOKE_REVISION_KEY) || '0'; }
  catch { return String(localRevokeRevision); }
}

/** Revoke all saved user turns before notifying generators. Never touch group or AMSG data. */
export function revokePendingChatAutoReplyIntents(): void {
  localRevokeRevision++;
  try {
    localStorage.setItem(CHAT_AUTO_REPLY_REVOKE_REVISION_KEY, crypto.randomUUID());
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sully_chat_auto_reply_intent_v1:')) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
  } catch { /* Current-page cancellation also uses the mode-change event. */ }
}

export function isRealPersonAutoReplyAuthorized(): boolean {
  try {
    if (!isRealPersonModeEnabled()) return false;
    // A saved 'on' from the previous UI is explicit permission; the absent
    // old key meant only default life mode, never automatic paid replies.
    return localStorage.getItem(REAL_PERSON_MODE_KEY) === 'on'
      || localStorage.getItem(REAL_PERSON_AUTO_REPLY_CONSENT_KEY) === 'on';
  } catch { return false; }
}


export function isRealPersonModeEnabled(): boolean {
  // Historical default is ON; keep existing autonomous-contact scheduling
  // compatible rather than silently disabling saved AMSG2 daily wakes.
  try { return typeof localStorage === 'undefined' || localStorage.getItem(REAL_PERSON_MODE_KEY) !== 'off'; }
  catch { return true; }
}

/** An answer to a saved user turn is NOT unsolicited contact.
 * Private-chat real-person mode answers without requiring AMSG2 permission;
 * the legacy group-chat preference never authorizes private-chat requests.
 */
export function shouldAutoReplyToUser(realPersonEnabled: boolean, _basicAutoReplyEnabled?: boolean): boolean {
  return realPersonEnabled;
}

export function canRealPersonContact(
  char: Pick<CharacterProfile, 'activeMsg2Config'> | null | undefined,
  modeEnabled = isRealPersonModeEnabled(),
): boolean {
  return modeEnabled && char?.activeMsg2Config?.enabled === true;
}

export function setRealPersonModeEnabled(enabled: boolean): void {
  if (!enabled) revokePendingChatAutoReplyIntents();
  try {
    localStorage.setItem(REAL_PERSON_MODE_KEY, enabled ? 'on' : 'off');
    localStorage.setItem(REAL_PERSON_AUTO_REPLY_CONSENT_KEY, enabled ? 'on' : 'off');
  }
  catch { /* Keep the current React state in non-persistent WebViews. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REAL_PERSON_MODE_CHANGED_EVENT));
}

/** Used ONLY for the optional daily autonomous-contact opportunity.
 * It does not replace the role card, worldbook, or normal private-chat prompt.
 */
export const REAL_PERSON_AUTONOMY_INSTRUCTION = [
  '【真人感自主联系：一次机会，不是必须发送的任务】',
  '先判断此刻有没有属于这个角色的具体缘由，再决定发不发。时间到了不是聊天理由。',
  '优先依据真实保存的未结束对话、近期确实发生过的经历、角色自己的兴趣与情绪、确实取得的工具结果。',
  '不要凭空捏造生活事件、关系进展或搜索经历；日程只是计划，不等于已经发生。',
  '已结束的话题不要重开；不要以“在吗”“在干嘛”“吃了吗”、查岗、日常报备或换皮问候填补沉默。',
  '符合角色的沉默与忙碌也是正常生活；有具体想法就用角色原本的口吻自然表达，不必固定句数。',
  '没有新鲜、具体、合理的联系契机时，整段只输出 [[SILENT]]，不要解释。',
  '不要透露调度器、任务、系统开关或后台机制。',
].join('\n');
