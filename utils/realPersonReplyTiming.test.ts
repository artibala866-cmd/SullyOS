import { describe, expect, it } from 'vitest';
import { resolveRealPersonReplyPlan } from './realPersonReplyTiming';
const plan = (activity: 'busy' | 'sleep' | 'free' | null, anchor = 1_000_000, now = anchor) =>
    resolveRealPersonReplyPlan({ activity, firstUnansweredAt: anchor, now, fallbackDelayMs: 90_000 });

describe('schedule grounded timing with no nudge score', () => {
    it('free and unknown keep bounded responsive waits', () => {
        expect(plan('free').delayMs).toBeGreaterThanOrEqual(2_500);
        expect(plan('free').delayMs).toBeLessThan(6_000);
        expect(plan(null).delayMs).toBe(9_000);
    });
    it('busy waits after one send, without fixed message-count thresholds', () => {
        const delay = plan('busy').delayMs!;
        expect(delay).toBeGreaterThanOrEqual(35_000);
        expect(delay).toBeLessThan(110_000);
        expect(plan('busy', 1_000_000, 1_010_000).delayMs).toBe(delay - 10_000);
        expect(plan('busy', 1_000_000, 2_000_000).delayMs).toBe(3_500);
    });
    it('sleep cannot be unlocked just by nudging', () => {
        expect(plan('sleep').delayMs).toBeNull();
        expect(plan('sleep', 1_000_000, 2_000_000).delayMs).toBeNull();
    });
    it('unknown state and invalid inputs never invent a busy state', () => {
        expect(resolveRealPersonReplyPlan({ activity:null, firstUnansweredAt:NaN, now:0, fallbackDelayMs:NaN }).delayMs).toBe(3_000);
    });
});
