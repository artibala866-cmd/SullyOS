import { describe, expect, it } from 'vitest';
import { resolveRealPersonReplyPlan } from './realPersonReplyTiming';
const plan = (activity: 'busy' | 'sleep' | 'free' | null, anchor = 1_000_000, now = anchor) =>
    resolveRealPersonReplyPlan({ activity, firstUnansweredAt: anchor, now, fallbackDelayMs: 90_000 });

describe('schedule grounded timing with no nudge score', () => {
    it('free and unknown keep bounded responsive waits', () => {
        expect(plan('free').delayMs).toBeGreaterThanOrEqual(3_400);
        expect(plan('free').delayMs).toBeLessThan(7_500);
        expect(plan(null).delayMs).toBe(9_000);
    });
    it('busy waits after one send, without fixed message-count thresholds', () => {
        const delay = plan('busy').delayMs!;
        expect(delay).toBeGreaterThanOrEqual(35_000);
        expect(delay).toBeLessThan(110_000);
        expect(plan('busy', 1_000_000, 1_010_000).delayMs).toBe(delay - 10_000);
        expect(plan('busy', 1_000_000, 2_000_000).delayMs).toBe(3_500);
    });
    it('recent actual back-and-forth is faster than a cold chat without bypassing sleep', () => {
        const anchor = 1_000_000;
        const base = resolveRealPersonReplyPlan({activity:'free', firstUnansweredAt:anchor,now:anchor,fallbackDelayMs:5000}).delayMs!;
        const active = resolveRealPersonReplyPlan({
            activity:'busy', firstUnansweredAt:anchor,now:anchor,fallbackDelayMs:5000,lastCharacterReplyAt:anchor-60_000,
        }).delayMs!;
        expect(active).toBeGreaterThanOrEqual(2_100);
        expect(active).toBeLessThan(5_100);
        expect(active).toBeLessThan(base);
        expect(resolveRealPersonReplyPlan({activity:'sleep',firstUnansweredAt:anchor,now:anchor,fallbackDelayMs:5000,lastCharacterReplyAt:anchor-200}).delayMs).toBeNull();
    });
    it('more successful messages preserve a reply batch but demand fresh quiet time after the last send', () => {
        const anchor = 1_000_000;
        const later = anchor + 95_000;
        const waiting = resolveRealPersonReplyPlan({
            activity:'busy',firstUnansweredAt:anchor,now:later,fallbackDelayMs:5000,lastUserSendAt:later,
        });
        expect(waiting.delayMs).toBe(3_500);
        const cold = resolveRealPersonReplyPlan({activity:'free', firstUnansweredAt:anchor,now:anchor,fallbackDelayMs:5000});
        const coldAgain = resolveRealPersonReplyPlan({activity:'free', firstUnansweredAt:anchor,now:anchor,fallbackDelayMs:5000});
        expect(cold).toEqual(coldAgain);
    });
    it('sleep cannot be unlocked just by nudging', () => {
        expect(plan('sleep').delayMs).toBeNull();
        expect(plan('sleep', 1_000_000, 2_000_000).delayMs).toBeNull();
    });
    it('unknown state and invalid inputs never invent a busy state', () => {
        expect(resolveRealPersonReplyPlan({ activity:null, firstUnansweredAt:NaN, now:0, fallbackDelayMs:NaN }).delayMs).toBe(3_000);
    });
});
