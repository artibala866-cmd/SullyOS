/** Single source of truth for real-person mode.
 * AMSG2 is the permission to contact User without a fresh user turn.
 * The private-chat "send then automatically reply" preference stays separate.
 */
import type { CharacterProfile } from '../types';

export const REAL_PERSON_MODE_KEY = 'sully_life_pacing';
export const REAL_PERSON_MODE_CHANGED_EVENT = 'sully:real-person-mode-changed';

export function isRealPersonModeEnabled(): boolean {
  try { return typeof localStorage === 'undefined' || localStorage.getItem(REAL_PERSON_MODE_KEY) !== 'off'; }
  catch { return true; }
}

export function canRealPersonContact(
  char: Pick<CharacterProfile, 'activeMsg2Config'> | null | undefined,
  modeEnabled = isRealPersonModeEnabled(),
): boolean {
  return modeEnabled && char?.activeMsg2Config?.enabled === true;
}

export function setRealPersonModeEnabled(enabled: boolean): void {
  try { localStorage.setItem(REAL_PERSON_MODE_KEY, enabled ? 'on' : 'off'); }
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
