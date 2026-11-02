/** Character-specific response habits for an ANSWER to a real user message.
 * Adapt the four attention states to SullyOS' own chat history and schedule.
 * No AI requests, extra clocks, prompt injection, or AMSG task creation here.
 */
export type RealPersonAttention = 'normal' | 'conversation' | 'occupied' | 'waiting';
export const REAL_PERSON_RHYTHM_STATES: readonly RealPersonAttention[] =
  ['normal', 'conversation', 'occupied', 'waiting'];
export const REAL_PERSON_CONVERSATION_WINDOW_MS = 12 * 60_000;

type ConversationMessage = {
  role: string;
  type?: string;
  timestamp?: number;
  deleted?: boolean;
  recalled?: boolean;
  capsuleOriginIds?: unknown;
  metadata?: {
    activeMsg2?: { taskId?: unknown };
    homeSceneRecord?: unknown;
    musicListenInvite?: unknown;
    musicListenInviteResponseTo?: unknown;
    chatBlockRejected?: unknown;
    historyImported?: unknown;
    importedFrom?: unknown;
    importedAt?: unknown;
    chatRecordImportedAt?: unknown;
    originalTimestamp?: unknown;
    userComposedAsCharacter?: unknown;
    aiGenerated?: unknown;
    offlineAutoReply?: unknown;
    phoneAutoReply?: unknown;
    aiPlaceholder?: unknown;
    conversationMutating?: unknown;
    deliveryStatus?: unknown;
    busyFauxAutoReply?: unknown;
    autoReply?: unknown;
    countsAsReply?: unknown;
  };
};
const isUserSpeech = (m: ConversationMessage): boolean =>
  m.role === 'user' && m.type !== 'system' && !m.deleted && !m.recalled &&
  !m.capsuleOriginIds && !m.metadata?.chatBlockRejected &&
  !m.metadata?.homeSceneRecord && !m.metadata?.musicListenInvite &&
  !m.metadata?.musicListenInviteResponseTo && !m.metadata?.historyImported &&
  !m.metadata?.importedFrom && !m.metadata?.importedAt &&
  !m.metadata?.chatRecordImportedAt && !m.metadata?.originalTimestamp &&
  !m.metadata?.userComposedAsCharacter && !m.metadata?.aiGenerated &&
  !m.metadata?.offlineAutoReply && !m.metadata?.phoneAutoReply &&
  !m.metadata?.aiPlaceholder && m.metadata?.conversationMutating !== false &&
  !['pending','rejected','failed'].includes(String(m.metadata?.deliveryStatus || ''));
const isRealAnswer = (m: ConversationMessage): boolean =>
  m.role === 'assistant' && m.type !== 'system' && !m.deleted && !m.recalled &&
  m.metadata?.activeMsg2?.taskId == null &&
  !m.metadata?.homeSceneRecord && !m.metadata?.musicListenInvite &&
  !m.metadata?.musicListenInviteResponseTo && !m.metadata?.historyImported &&
  !m.metadata?.importedFrom && !m.metadata?.busyFauxAutoReply &&
  !m.metadata?.phoneAutoReply && !m.metadata?.offlineAutoReply &&
  !m.metadata?.autoReply && m.metadata?.countsAsReply !== false;
const isValidAt = (at: unknown, now: number): at is number =>
  typeof at === 'number' && Number.isFinite(at) && at > 0 && at <= now;

/** A real, answered exchange is evidence of ongoing attention. An AMSG push
 * cannot make an otherwise cold chat look like a back-and-forth conversation.
 * A phone/schedule 'busy' slot wins when the character has not actually replied.
 */
export function resolveRealPersonAttention(
  messages: readonly ConversationMessage[],
  now: number,
  activity: 'free' | 'busy' | 'sleep' | null,
): RealPersonAttention {
  const visible = messages.filter(m => isUserSpeech(m) || isRealAnswer(m));
  const last = visible.at(-1);
  if (!last || !isUserSpeech(last) || !isValidAt(last.timestamp, now))
    return activity === 'busy' || activity === 'sleep' ? 'occupied' : 'normal';
  let assistantIndex = -1;
  for (let index = visible.length - 1; index >= 0; index--) {
    if (isRealAnswer(visible[index])) { assistantIndex = index; break; }
  }
  if (assistantIndex < 0)
    return activity === 'busy' || activity === 'sleep' ? 'occupied' : 'normal';
  const answer = visible[assistantIndex];
  const repliedAt = answer.timestamp;
  if (!isValidAt(repliedAt, now) ||
      last.timestamp! < repliedAt ||
      last.timestamp! - repliedAt > REAL_PERSON_CONVERSATION_WINDOW_MS)
    return activity === 'busy' || activity === 'sleep' ? 'occupied' : 'normal';
  // Require a real user statement before that answer, not an unsolicited push.
  const previous = visible.slice(0, assistantIndex).reverse().find(isUserSpeech);
  if (!previous || !isValidAt(previous.timestamp, now) ||
      previous.timestamp! > repliedAt ||
      repliedAt - previous.timestamp! > REAL_PERSON_CONVERSATION_WINDOW_MS)
    return activity === 'busy' || activity === 'sleep' ? 'occupied' : 'normal';
  // Sleep is still handled by a separate hard availability gate, not by this state.
  if (activity === 'sleep') return 'occupied';
  return last.timestamp! - repliedAt <= 25_000 ? 'waiting' : 'conversation';
}
