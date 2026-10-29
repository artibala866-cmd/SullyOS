/** Decision-only schedule-aware timing for an already successful user send.
 * Never edits chat prompts or schedules independent AI work.
 * Sleep can remain silent; a busy user turn waits without any nudge-score unlock.
 */
export type RealPersonLifeActivity = 'free' | 'busy' | 'sleep' | null;
export type RealPersonReplyPlan = { delayMs: number | null };

export function resolveRealPersonReplyPlan(args: {
    activity: RealPersonLifeActivity;
    firstUnansweredAt: number;
    now: number;
    fallbackDelayMs: number;
}): RealPersonReplyPlan {
    const { activity, now } = args;
    const anchor = Number.isFinite(args.firstUnansweredAt) && args.firstUnansweredAt >= 0
        ? Math.trunc(args.firstUnansweredAt) : now;
    if (activity === 'sleep') return { delayMs: null };
    if (activity === 'busy') {
        // This delay is anchored to the first saved user message in the turn.
        // Further messages don't unlock a fixed reply threshold.
        const targetWait = 35_000 + (anchor % 75_000);
        const elapsed = Number.isFinite(now) ? Math.max(0, now - anchor) : 0;
        return { delayMs: Math.max(3_500, targetWait - elapsed) };
    }
    if (activity === 'free') return { delayMs: 2_500 + (anchor % 3_500) };
    // Missing schedule is unknown, never proof of being busy or sleeping.
    const fallback = Number.isFinite(args.fallbackDelayMs) ? args.fallbackDelayMs : 3_000;
    return { delayMs: Math.max(2_500, Math.min(9_000, Math.trunc(fallback))) };
}
