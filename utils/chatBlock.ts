import type { ChatBlockState, ChatBlockEvent } from '../types';
/** 拉黑双向独立；框架层不凭空判断剧情、不修改角色人设。 */
export type ChatBlockActor = 'user' | 'character';
export const userBlocksCharacter = (state?: ChatBlockState | null): boolean =>
  typeof state?.userBlockedAt === 'number' && Number.isFinite(state.userBlockedAt) && state.userBlockedAt > 0;
export const characterBlocksUser = (state?: ChatBlockState | null): boolean =>
  typeof state?.characterBlockedAt === 'number' && Number.isFinite(state.characterBlockedAt) && state.characterBlockedAt > 0;
export const allowsCharacterToBlock = (state?: ChatBlockState | null): boolean => state?.allowCharacterBlockUser !== false;
export const isPrivateChatBlocked = (state?: ChatBlockState | null): boolean =>
  userBlocksCharacter(state) || characterBlocksUser(state);
/** 幂等更新 + 有界事件史；解除自己的拉黑不影响对方的独立状态。 */
export function changeChatBlock(
  previous: ChatBlockState | undefined,
  actor: ChatBlockActor,
  blocked: boolean,
  opts: { at?: number; reason?: string; source?: ChatBlockEvent['source'] } = {},
): ChatBlockState {
  const old = previous ?? {};
  if (actor === 'character' && blocked && !allowsCharacterToBlock(old)) return old;
  const current = actor === 'user' ? userBlocksCharacter(old) : characterBlocksUser(old);
  if (current === blocked) return old;
  const at = Number.isFinite(opts.at) && (opts.at ?? 0) > 0 ? Math.floor(opts.at!) : Date.now();
  const key = actor === 'user' ? 'userBlockedAt' : 'characterBlockedAt';
  const event: ChatBlockEvent = {
    actor, action: blocked ? 'block' : 'unblock', at,
    ...(opts.reason?.trim() ? { reason: opts.reason.trim().slice(0, 600) } : {}),
    ...(opts.source ? { source: opts.source } : {}),
  };
  return { ...old, [key]: blocked ? at : undefined,
    history: [...(old.history ?? []), event].slice(-40) };
}
/** 原版关闭 Char 自主拉黑权限时，同时解除这一方向的拉黑。 */
export function configureCharacterBlocking(previous: ChatBlockState | undefined, allowed: boolean, at?: number): ChatBlockState {
  const state = previous ?? {};
  const unlocked = allowed ? state : changeChatBlock(state, 'character', false, { at, source: 'settings' });
  return { ...unlocked, allowCharacterBlockUser: allowed };
}
