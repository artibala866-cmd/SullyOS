import { describe, expect, it } from 'vitest';
import { resolveRealPersonReplyPlan } from './realPersonReplyTiming';
const plan = (activity: 'busy'|'sleep'|'free'|null, nudgeScore: number, now = 0) =>
    resolveRealPersonReplyPlan({ activity, nudgeScore, firstUnansweredAt: 0, now, fallbackDelayMs: 9_000 });

describe('schedule-grounded real-person reply policy', () => {
    it('free and missing schedules retain fast deterministic fallbacks', () => {
        expect(plan('free', 1).delayMs).toBe(3_000);
        expect(plan(null, 1).delayMs).toBe(9_000);
    });
    it('a busy character does not wake just because the clock advanced hours', () => {
        expect(plan('busy', 1, 2 * 60 * 60_000).delayMs).toBeNull();
        expect(plan('busy', 3, 2 * 60 * 60_000).delayMs).toBeNull();
        expect(plan('busy', 4, 8 * 60_000).delayMs).toBe(4_500);
        expect(plan('busy', 6).delayMs).toBe(4_500);
    });
    it('sleep takes more deliberate nudges and no time bonus', () => {
        expect(plan('sleep', 6, 10 * 60 * 60_000).delayMs).toBeNull();
        expect(plan('sleep', 7).delayMs).toBe(12_000);
    });
    it('never generates a new fact or empty fake reply request', () => {
        expect(plan('busy', Number.NaN).delayMs).toBeNull();
        expect(plan(null, -1).delayMs).toBeGreaterThan(0);
    });
});
