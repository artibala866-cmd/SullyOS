/** Character-specific response habits for an ANSWER to a real user message.
 * Adapt the four attention states to SullyOS' own chat history and schedule.
 * No AI requests, extra clocks, prompt injection, or AMSG task creation here.
 */
export type RealPersonAttention = 'normal' | 'conversation' | 'occupied' | 'waiting';
export type RealPersonReplyRange = { minSeconds: number; maxSeconds: number };
export type RealPersonReplyRhythm = Record<RealPersonAttention, RealPersonReplyRange>;

export const DEFAULT_REAL_PERSON_REPLY_RHYTHM: Readonly<RealPersonReplyRhythm> = {
  normal: { minSeconds: 4, maxSeconds: 9 },
  conversation: { minSeconds: 2, maxSeconds: 5 },
  occupied: { minSeconds: 35, maxSeconds: 110 },
  waiting: { minSeconds: 2, maxSeconds: 4 },
};
export const REAL_PERSON_RHYTHM_STATES: readonly RealPersonAttention[] =
  ['normal', 'conversation', 'occupied', 'waiting'];
/** Longer waits are opt-in per character, not inferred from time of day. */
export const MAX_REAL_PERSON_REPLY_SECONDS = 7_200;
export const REAL_PERSON_CONVERSATION_WINDOW_MS = 12 * 60_000;

const validSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= MAX_REAL_PERSON_REPLY_SECONDS
    ? Math.round(value) : null;

export function normalizeRealPersonReplyRhythm(
  value: Partial<Record<RealPersonAttention, Partial<RealPersonReplyRange>>> | null | undefined,
): RealPersonReplyRhythm {
  const result = {} as RealPersonReplyRhythm;
  for (const state of REAL_PERSON_RHYTHM_STATES) {
    const fallback = DEFAULT_REAL_PERSON_REPLY_RHYTHM[state];
    const saved = value?.[state];
    const min = validSeconds(saved?.minSeconds) ?? fallback.minSeconds;
    const max = validSeconds(saved?.maxSeconds) ?? fallback.maxSeconds;
    result[state] = { minSeconds: Math.min(min, max), maxSeconds: Math.max(min, max) };
  }
  return result;
}

type ConversationMessage = {
  role: string;
  type?: string;
  timestamp?: number;
  metadata?: {
    activeMsg2?: { taskId?: unknown };
    homeSceneRecord?: unknown;
    musicListenInvite?: unknown;
    musicListenInviteResponseTo?: unknown;
    chatBlockRejected?: unknown;
    historyImported?: unknown;
    importedFrom?: unknown;
  };
};
const isUserSpeech = (m: ConversationMessage): boolean =>
  m.role === 'user' && m.type !== 'system' && !m.metadata?.chatBlockRejected &&
  !m.metadata?.homeSceneRecord && !m.metadata?.musicListenInvite &&
  !m.metadata?.musicListenInviteResponseTo && !m.metadata?.historyImported &&
  !m.metadata?.importedFrom;
const isRealAnswer = (m: ConversationMessage): boolean =>
  m.role === 'assistant' && m.type !== 'system' && m.metadata?.activeMsg2?.taskId == null &&
  !m.metadata?.homeSceneRecord && !m.metadata?.musicListenInvite &&
  !m.metadata?.musicListenInviteResponseTo;
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

/** Stable within a saved user batch; character profile + first-send timestamp
 * form the seed, never message count. Returns elapsed wait before first reply. */
export function sampleRealPersonRhythmMs(
  state: RealPersonAttention,
  characterId: string,
  firstUnansweredAt: number,
  profile?: Partial<Record<RealPersonAttention, Partial<RealPersonReplyRange>>> | null,
): number {
  const range = normalizeRealPersonReplyRhythm(profile)[state];
  let hash = 2166136261;
  const seed = characterId + ':' + firstUnansweredAt + ':' + state;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  const minMs = range.minSeconds * 1000;
  const maxMs = range.maxSeconds * 1000;
  return minMs + hash % (maxMs - minMs + 1);
}
