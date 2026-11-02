import { findPendingUserTurn } from './chatContinuation';

/** Filter ONLY the private-chat auto-response candidate. Music actions have
 * their own immediate bridge; app cards and rejected sends are not dialogue.
 * Keep the original chatContinuation helper untouched for other modules.
 */
type ChatTurn = {
  role: string;
  timestamp?: number;
  type?: string;
  metadata?: {
    musicListenInvite?: unknown;
    musicListenInviteResponseTo?: unknown;
    homeSceneRecord?: unknown;
    chatBlockRejected?: unknown;
    historyImported?: unknown;
    importedFrom?: unknown;
    [key: string]: any;
  };
};
export function findPendingRealPersonUserTurn<T extends ChatTurn>(history: readonly T[]): T | null {
  const conversation = history.filter(m =>
    (m.role === 'user' || m.role === 'assistant') &&
    m.type !== 'system' && !m.metadata?.homeSceneRecord &&
    !m.metadata?.musicListenInvite && !m.metadata?.musicListenInviteResponseTo &&
    !m.metadata?.chatBlockRejected &&
    !m.metadata?.historyImported && !m.metadata?.importedFrom);
  return findPendingUserTurn(conversation);
}

/**
 * A real-person auto-reply is strictly a response to a saved, unanswered user
 * turn. The local/cloud model receives the same real history; this narrow
 * request-level focus sits AFTER optional life/schedule/phone context so those
 * facts cannot become an unsolicited new conversation topic.
 *
 * AMSG autonomous wakes and manual continuation never pass through this gate.
 */
export function buildRealPersonTurnFocusHint<T extends ChatTurn & { id?: number }>(
  messages: readonly T[], expectedUserId?: number,
): string {
  const pending = findPendingRealPersonUserTurn(messages);
  if (!pending || typeof pending.id !== 'number' ||
      (expectedUserId !== undefined && pending.id !== expectedUserId)) return '';
  const visible = messages.filter(m =>
    (m.role === 'user' || m.role === 'assistant') &&
    m.type !== 'system' && !m.metadata?.homeSceneRecord &&
    !m.metadata?.musicListenInvite && !m.metadata?.musicListenInviteResponseTo &&
    !m.metadata?.historyImported && !m.metadata?.importedFrom && !m.metadata?.chatBlockRejected);
  // The scheduled proactive bubble AFTER the pending turn is ignored when
  // deciding if it has been answered, but one BETWEEN two user sends is still
  // a genuine conversation boundary. Don't combine messages separated by a
  // proactive note or by hours into an invented "just sent together" batch.
  const pendingIndex = visible.findIndex(m => m.id === pending.id);
  let consecutiveUserMessages = 0;
  let nextAt = pending.timestamp;
  for (let i = pendingIndex; i >= 0 && visible[i].role === 'user'; i--) {
    const previousAt = visible[i].timestamp;
    if (consecutiveUserMessages > 0 &&
        typeof nextAt === 'number' && typeof previousAt === 'number' &&
        nextAt - previousAt > 90_000) break;
    consecutiveUserMessages++;
    nextAt = previousAt;
  }
  return [
    '【本轮是真实用户消息触发的接话，不是自主联系】',
    consecutiveUserMessages > 1
      ? `对方刚连续发送了 ${consecutiveUserMessages} 条消息；把它们当作同一段表达，尤其照顾最新一句，不要只回答第一句。`
      : '对方刚发了一条新消息；先接住这条消息的具体意思和紧接着的对话上下文。',
    '先回应对方正在讨论、追问、表达的事情；已在讨论的问题不要突然改成问候、查岗或其他新话题。',
    '角色自己的生活、日程、情绪和工具结果只在确实与眼前内容相关时自然带出；不能拿它们当作另起话题的任务。',
    '没有依据就不要声称“我刚刚做了什么”或突然问“吃了吗”“在干嘛”；不必为了显得有生活而额外问一句。',
    '允许按人设反问、争论、调侃、简短回应或者延续原话；不要固定套用相同模板。',
  ].join('\n');
}
