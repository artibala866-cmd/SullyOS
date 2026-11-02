import { findPendingUserTurn } from './chatContinuation';
import type { Message } from '../types';
import {
  advanceConversationEngagement, loadConversationEngagementState,
  type ConversationEngagementAnalysis,
} from './memoryPalace/conversationEngagement';

/** Filter ONLY the private-chat auto-response candidate. Music actions have
 * their own immediate bridge; app cards and rejected sends are not dialogue.
 * Keep the original chatContinuation helper untouched for other modules.
 */
type ChatTurn = {
  role: string;
  timestamp?: number;
  type?: string;
  deleted?: boolean;
  recalled?: boolean;
  capsuleOriginIds?: unknown;
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
/** A real saved user statement, not an imported, app-generated, failed or
 * merely staged message. Mirrors the provenance gates from the reference APK,
 * using SullyOS message metadata rather than importing its chat data model.
 */
export function isRealPersonUserStatement(m: ChatTurn): boolean {
  if (m.role !== 'user' || m.type === 'system' || m.deleted || m.recalled ||
      m.capsuleOriginIds || m.metadata?.homeSceneRecord ||
      m.metadata?.musicListenInvite || m.metadata?.musicListenInviteResponseTo ||
      m.metadata?.chatBlockRejected || m.metadata?.historyImported ||
      m.metadata?.importedFrom || m.metadata?.importedAt ||
      m.metadata?.chatRecordImportedAt || m.metadata?.originalTimestamp ||
      m.metadata?.userComposedAsCharacter || m.metadata?.aiGenerated ||
      m.metadata?.offlineAutoReply || m.metadata?.phoneAutoReply ||
      m.metadata?.aiPlaceholder || m.metadata?.conversationMutating === false)
    return false;
  const status = String(m.metadata?.deliveryStatus || '');
  return status !== 'pending' && status !== 'rejected' && status !== 'failed';
}

function isActualCharacterAnswer(m: ChatTurn): boolean {
  return m.role === 'assistant' && m.type !== 'system' &&
    !m.deleted && !m.recalled && !m.metadata?.homeSceneRecord &&
    !m.metadata?.musicListenInvite && !m.metadata?.musicListenInviteResponseTo &&
    !m.metadata?.historyImported && !m.metadata?.importedFrom &&
    !m.metadata?.busyFauxAutoReply && !m.metadata?.phoneAutoReply &&
    !m.metadata?.offlineAutoReply && !m.metadata?.autoReply &&
    m.metadata?.countsAsReply !== false;
}

export function findPendingRealPersonUserTurn<T extends ChatTurn>(history: readonly T[]): T | null {
  const conversation = history.filter(m =>
    isRealPersonUserStatement(m) || isActualCharacterAnswer(m));
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
  engagement?: ConversationEngagementAnalysis,
): string {
  const pending = findPendingRealPersonUserTurn(messages);
  if (!pending || typeof pending.id !== 'number' ||
      (expectedUserId !== undefined && pending.id !== expectedUserId)) return '';
  const visible = messages.filter(m =>
    isRealPersonUserStatement(m) || isActualCharacterAnswer(m));
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
    ...renderRealPersonConversationPlan(engagement),
  ].join('\n');
}

/** Use SullyOS' own M3 conversation tracking instead of a second topic engine. */
export function renderRealPersonConversationPlan(a?: ConversationEngagementAnalysis): string[] {
  if (!a?.analyzable) return [];
  const acts: Record<string,string> = {
    acknowledge:'acknowledge the newest detail',
    invite:'leave space without requiring a question',
    follow:'follow this topic and its latest change',
    clarify:'clarify only an essential unknown',
    reflect:'connect previously stated facts',
    evaluate:'form a grounded opinion',
    close:'respect the ending',
    shift:'follow the topic change initiated by the user',
  };
  const move = a.conversationAct === 'close' ? 'close'
    : a.conversationAct === 'shift' ? 'user_shift' : 'continue';
  return [
    '[Existing M3 conversation state for this actual user reply]',
    'topicMove='+move+'; primary='+ (acts[a.responsePlan.primary] || 'acknowledge'),
    a.responsePlan.secondary ? 'Optional: '+acts[a.responsePlan.secondary]+' (not required)' : 'No mandatory second act',
    a.subject.active && a.subject.unresolvedHookKinds.length && move !== 'close'
      ? 'There are unfinished details; keep track without interrogating the user.'
      : 'Do not invent unfinished details to keep a conversation going.',
    a.responsePlan.explicitQuestionBudget === 0
      ? 'Do not append a question just to extend this conversation.'
      : 'At most one truly relevant question, and none if not necessary.',
    'A character may have opinions and a life, but personal reports and topic changes are not mandatory.',
    'No output length, bubble count, self-disclosure or follow-up quota is implied by this plan.',
  ];
}

/**
 * Stateless replay through the EXISTING M3 state machine. The optional Memory
 * Palace M3 flag might be off; this still follows the conversation's known
 * user turns without enabling M3 storage or introducing another topic store.
 * Replays the last 8 user bursts; all transitions are deterministic and local.
 */
export function analyzeRealPersonConversation(
  charId: string,
  messages: readonly Message[],
  charName?: string,
  userName?: string,
): ConversationEngagementAnalysis | undefined {
  // Preserve the boundary of an intervening AMSG without treating its
  // content as an answer, a user prompt, or a new topic. Dropping that bubble
  // entirely would accidentally merge two separate user bursts into one,
  // causing M3 to analyze the older topic as if it were said just now.
  // This is a request-local, neutral M3 input only: no DB/message/UI changes.
  const dialogue: Message[] = messages.flatMap(m => {
    if (isRealPersonUserStatement(m)) return [m];
    if (!isActualCharacterAnswer(m)) return [];
    if (m.metadata?.activeMsg2?.taskId != null)
      return [{ ...m, type: 'text' as const, content: '[自主消息到达，不代表已回复用户]' }];
    return [m];
  });
  const userBursts: number[] = [];
  for (let i = 0; i < dialogue.length; i++) {
    if (dialogue[i].role === 'user' &&
        (i === dialogue.length - 1 || dialogue[i + 1].role !== 'user')) userBursts.push(i);
  }
  if (!userBursts.length) return undefined;
  const stored = loadConversationEngagementState(charId);
  const storedIndex = stored?.lastProcessedMessageId != null
    ? dialogue.findIndex(m => m.id === stored.lastProcessedMessageId) : -1;
  // Use a saved M3 subject only when its last processed source still exists.
  // Replay intermediate user turns one by one; jumping straight to the final
  // turn would lose the topic evolution while M3 was disabled.
  let previous: ReturnType<typeof advanceConversationEngagement>['state'] | undefined =
    storedIndex >= 0 ? stored : undefined;
  let lastTurnAt: number | undefined = storedIndex >= 0
    ? dialogue[storedIndex].timestamp : undefined;
  const missingTurns = userBursts.filter(index => index > storedIndex).slice(-8);
  if (missingTurns.length === 0 && storedIndex >= 0) {
    return advanceConversationEngagement(charId, dialogue, previous, charName, userName).analysis;
  }
  for (const index of missingTurns) {
    const currentAt = dialogue[index].timestamp;
    // M3 expires a subject after 12 h. Replaying old messages at one Date.now
    // must not make their stale topic appear live again.
    if (typeof currentAt === 'number' && typeof lastTurnAt === 'number' &&
        currentAt - lastTurnAt > 12 * 60 * 60_000) previous = undefined;
    previous = advanceConversationEngagement(
      charId, dialogue.slice(0, index + 1), previous, charName, userName,
    ).state;
    lastTurnAt = currentAt;
  }
  return previous?.lastAnalysis;
}
