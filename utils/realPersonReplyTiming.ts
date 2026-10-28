/** Decision-only replacement of the old "delay then always reply" real-person mode.
 * Drawn from observed APK busy/soft-offline + consecutive user nudges, adapted to
 * SullyOS's EXISTING schedule and chat. No prompts, API calls or messages here.
 * Never invent a busy state. If schedule is absent preserve the existing clock delay.
 */
export type RealPersonLifeActivity = 'free' | 'busy' | 'sleep' | null;
export type RealPersonReplyPlan = { delayMs: number | null; waitingReason: string | null };
export const REAL_PERSON_BUSY_WAKE_SCORE = 6;
export const REAL_PERSON_SLEEP_WAKE_SCORE = 7;
export const REAL_PERSON_BUSY_TIME_BONUS_CAP = 2;

export function resolveRealPersonReplyPlan(args: {
    activity: RealPersonLifeActivity;
    nudgeScore: number;
    firstUnansweredAt: number;
    now: number;
    fallbackDelayMs: number;
}): RealPersonReplyPlan {
    const { activity, firstUnansweredAt, now } = args;
    const nudges = Number.isFinite(args.nudgeScore) ? Math.max(0, Math.trunc(args.nudgeScore)) : 0;
    if (activity === 'sleep') {
        return nudges >= REAL_PERSON_SLEEP_WAKE_SCORE
            ? { delayMs: 12_000, waitingReason: null }
            : { delayMs: null, waitingReason: 'TA 正在休息，暂时没有看消息 · 可以继续留言或戳一戳' };
    }
    if (activity === 'busy') {
        // Time alone cannot wake a busy character: at least four actual nudges
        // are still needed while the current schedule slot remains busy.
        const minutes = Number.isFinite(now) && Number.isFinite(firstUnansweredAt)
            ? Math.max(0, (now - firstUnansweredAt) / 60_000) : 0;
        const score = nudges + Math.min(REAL_PERSON_BUSY_TIME_BONUS_CAP, Math.floor(minutes / 4));
        return score >= REAL_PERSON_BUSY_WAKE_SCORE
            ? { delayMs: 4_500, waitingReason: null }
            : { delayMs: null, waitingReason: 'TA 正在忙，暂时没有回复 · 继续发消息或戳一戳可能唤回' };
    }
    if (activity === 'free') return { delayMs: 3_000, waitingReason: null };
    const delay = Number.isFinite(args.fallbackDelayMs)
        ? Math.min(120_000, Math.max(2_000, Math.trunc(args.fallbackDelayMs))) : 3_000;
    return { delayMs: delay, waitingReason: null };
}
