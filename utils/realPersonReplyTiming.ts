/** Timing policy for answering a SAVED user turn, not for starting a conversation.
 * Key principles adapted from a real-person rhythm model: treat back-and-forth
 * as evidence of attention; keep one stable decision for an unanswered batch;
 * never infer presence from the wall clock or force extra messages to unlock it.
 */
import { sampleRealPersonRhythmMs, type RealPersonAttention, type RealPersonReplyRhythm } from './realPersonReplyRhythm';

export type RealPersonLifeActivity = 'free' | 'busy' | 'sleep' | null;
export type RealPersonReplyPlan = { delayMs: number | null };

export function resolveRealPersonReplyPlan(args: {
    activity: RealPersonLifeActivity;
    firstUnansweredAt: number;
    now: number;
    fallbackDelayMs: number;
    lastUserSendAt?: number;
    lastCharacterReplyAt?: number;
    replyAttention?: RealPersonAttention;
    replyRhythm?: Partial<RealPersonReplyRhythm>;
    characterId?: string;
}): RealPersonReplyPlan {
    const { activity, now } = args;
    const anchor = Number.isFinite(args.firstUnansweredAt) && args.firstUnansweredAt >= 0
        ? Math.trunc(args.firstUnansweredAt) : now;
    const latestUser = Number.isFinite(args.lastUserSendAt) && (args.lastUserSendAt ?? 0) >= anchor
        ? Math.min(now, args.lastUserSendAt!) : anchor;
    const elapsed = Number.isFinite(now) ? Math.max(0, now - anchor) : 0;
    // Recent actual replies, not an online badge, are evidence that a conversation is underway.
    const lastReply = args.lastCharacterReplyAt ?? 0;
    const engaged = Number.isFinite(lastReply) && lastReply > 0 && lastReply <= anchor
        && anchor - lastReply <= 12 * 60_000;
    // Keep a short quiet window after the latest successful send, even if the
    // earlier part of this batch already waited through a busy period.
    const inputSettle = Math.max(0, (engaged ? 1_700 : 2_800) - Math.max(0, now - latestUser));
    if (activity === 'sleep') return { delayMs: null };
    // Sample only once from the first user turn; later sends extend quiet time.
    if (args.replyAttention && args.characterId) {
        const planned = sampleRealPersonRhythmMs(args.replyAttention, args.characterId, anchor, args.replyRhythm);
        const floor = args.replyAttention === 'occupied' ? 3_500 : 1_000;
        return { delayMs: Math.max(floor, planned - elapsed, inputSettle) };
    }

    if (activity === 'busy' && !engaged) {
        // A real occupied slot may delay the FIRST reply, not reset each time
        // the user sends another message. More messages never buy instant attention.
        const busyDelay = 35_000 + (anchor % 75_000);
        return { delayMs: Math.max(3_500, busyDelay - elapsed, inputSettle) };
    }
    if (activity === 'free' || (activity === 'busy' && engaged)) {
        // Stable per unanswered batch, but different turns don't all get the
        // same robotic delay. Back-and-forth is quicker than a cold start.
        const jitter = (Math.floor(anchor / 137) + (anchor % 997)) >>> 0;
        const target = engaged ? 2_100 + jitter % 3_000 : 3_400 + jitter % 4_100;
        return { delayMs: Math.max(1_000, target - elapsed, inputSettle) };
    }
    // Missing schedule is unknown, never proof of being busy or sleeping.
    const fallback = Number.isFinite(args.fallbackDelayMs) ? args.fallbackDelayMs : 3_000;
    const bounded = Math.max(2_500, Math.min(9_000, Math.trunc(fallback)));
    return { delayMs: Math.max(1_000, bounded - elapsed, inputSettle) };
}
