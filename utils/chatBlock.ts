import type { ChatBlockState, ChatBlockEvent, Message } from '../types';
/** 拉黑双向独立；框架层不凭空判断剧情、不修改角色人设。 */
export type ChatBlockActor = 'user' | 'character';
export const userBlocksCharacter = (state?: ChatBlockState | null): boolean =>
  typeof state?.userBlockedAt === 'number' && Number.isFinite(state.userBlockedAt) && state.userBlockedAt > 0;
export const characterBlocksUser = (state?: ChatBlockState | null): boolean =>
  typeof state?.characterBlockedAt === 'number' && Number.isFinite(state.characterBlockedAt) && state.characterBlockedAt > 0;
export const allowsCharacterToBlock = (state?: ChatBlockState | null): boolean => state?.allowCharacterBlockUser !== false;
export const isPrivateChatBlocked = (state?: ChatBlockState | null): boolean =>
  userBlocksCharacter(state) || characterBlocksUser(state);

/** 单向拉黑与双向拉黑分开判断：用户封锁阻止发送，角色封锁使用户消息被拒收。 */
export const privateChatBlockDirection = (state?: ChatBlockState | null): 'none' | 'user' | 'character' | 'both' => {
  const byUser = userBlocksCharacter(state);
  const byCharacter = characterBlocksUser(state);
  return byUser && byCharacter ? 'both' : byUser ? 'user' : byCharacter ? 'character' : 'none';
};

/** 历史红色感叹号必须按「发送时」判定，不应随解除拉黑回溯变化。
 * 事件史只保留有限条，缺事件时退回仍有效的 blockedAt。
 */
export function userBlockedCharacterAt(state: ChatBlockState | null | undefined, at: number): boolean {
  if (!Number.isFinite(at) || at <= 0) return userBlocksCharacter(state);
  const history = (state?.history || [])
    .filter(e => e.actor === 'user' && Number.isFinite(e.at) && e.at <= at)
    .sort((a,b) => a.at - b.at);
  if (history.length) return history[history.length - 1].action === 'block';
  // 历史只保留 40 条。裁剪时记录当时的状态；否则旧云端消息晚到，
  // 会把当前一轮新拉黑误判成旧消息的状态，或把旧的失败回复改成成功。
  const anchor = state?.userBlockHistoryAnchor;
  if (anchor && at >= anchor.at) return anchor.blocked;
  if (anchor && at < anchor.at) return false; // 裁剪之前的未知历史，不能用现在的状态倒推
  return userBlocksCharacter(state) && (state?.userBlockedAt || 0) <= at;
}

/** 请求期间用户可以拉黑或解除拉黑：任何一段生成时间内被用户拉黑的回复，
 * 一旦作为发送失败保存，不得在解除后变成正常送达。历史消息仍按落库 metadata 显示。
 */
/** 云端延迟收件按 Char 真正发送的时刻判定，而不是用户打开聊天的时刻。
 * 发送时间缺失时才退回当前状态；否则解除/重新拉黑会把旧回复的感叹号画错。
 */
export function didCharReplyFailAtDelivery(state: ChatBlockState | null | undefined, sentAt?: number | null): boolean {
  return typeof sentAt === 'number' && Number.isFinite(sentAt) && sentAt > 0
    ? userBlockedCharacterAt(state, sentAt)
    : userBlocksCharacter(state);
}
export function didCharReplyFailDuringGeneration(
  blockedAtStart: boolean, blockedAtEnd: boolean,
  currentState?: ChatBlockState | null, startedAt?: number, finishedAt: number = Date.now(),
): boolean {
  if (blockedAtStart || blockedAtEnd) return true;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  const lastBlockAt = currentState?.lastUserBlockAt;
  if (typeof lastBlockAt === 'number' && lastBlockAt >= startedAt && lastBlockAt <= finishedAt) return true;
  // 生成时用户短暂拉黑又解除，首尾两次 boolean 均为 false。
  // 仍应记住这段回复在生成中曾被拒绝送达，不能在重载后变成成功。
  return (currentState?.history || []).some(event =>
    event.actor === 'user' && event.action === 'block'
    && event.at >= startedAt && event.at <= finishedAt,
  );
}

/** UI 必须按消息发送当时的状态绘制，不以当前角色关系反算历史感叹号。 */
export const privateChatDeliveryFailure = (message: Pick<Message, 'role' | 'metadata'>): 'user-rejected' | 'char-send-failed' | null =>
  message.role === 'user' && message.metadata?.chatBlockRejected === true ? 'user-rejected'
    : message.role === 'assistant' && message.metadata?.chatBlockSendFailed === true ? 'char-send-failed' : null;

/** 被角色拒收的消息只保留在用户本地聊天记录，不得进入角色上下文、总结或后续 AI 输入。 */
export const isRejectedPrivateMessage = (message: Pick<Message, 'role' | 'metadata'>): boolean =>
  message.role === 'user' && message.metadata?.chatBlockRejected === true;
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
  const allEvents = [...(old.history ?? []), event];
  const removedEvents = allEvents.slice(0, Math.max(0, allEvents.length - 40));
  const removedUserEvent = [...removedEvents].reverse().find(e => e.actor === 'user');
  const userBlockHistoryAnchor = removedUserEvent
    ? { at: removedUserEvent.at, blocked: removedUserEvent.action === 'block' }
    : old.userBlockHistoryAnchor;
  return { ...old, [key]: blocked ? at : undefined,
    ...(actor === 'character' && blocked ? { lastCharacterBlockReason: opts.reason?.trim().slice(0, 600) || '' } : {}),
    ...(actor === 'user' && blocked ? { lastUserBlockAt: at } : {}),
    ...(userBlockHistoryAnchor ? { userBlockHistoryAnchor } : {}),
    // 新一次角色拉黑必须重新计算心软冷却，不继承旧一轮求原谅状态。
    ...(actor === 'character' ? {
      lastForgivenessCheckAt: blocked ? at : undefined,
      lastForgivenessSign: undefined,
      ...(blocked ? { forgivenessSoftness: 10, lastForgivenessThought: undefined, lastForgivenessStatus: undefined, forgivenessDrafts: [], forgivenessScenes: [] } : {}),
    } : {}),
    history: allEvents.slice(-40) };
}
/** 原版关闭 Char 自主拉黑权限时，同时解除这一方向的拉黑。 */
export function configureCharacterBlocking(previous: ChatBlockState | undefined, allowed: boolean, at?: number): ChatBlockState {
  const state = previous ?? {};
  const unlocked = allowed ? state : changeChatBlock(state, 'character', false, { at, source: 'settings' });
  return { ...unlocked, allowCharacterBlockUser: allowed };
}
