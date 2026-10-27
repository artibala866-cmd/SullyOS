import { describe, expect, it } from 'vitest';
import { createEmptySparkCommunityState } from './sparkCommunity';
import { getSparkTrafficLocalDay, reserveSparkTrafficRun } from './sparkTraffic';

describe('Spark autonomous traffic budget', () => {
    it('never reserves a request while autonomous activity is disabled', () => {
        const state = createEmptySparkCommunityState();
        const result = reserveSparkTrafficRun(state, new Date(2026, 9, 27, 12).getTime());
        expect(result).toMatchObject({ allowed: false, reason: 'disabled' });
        expect(result.state).toBe(state);
    });

    it('reserves at most one call per minimum interval and respects the daily cap', () => {
        const now = new Date(2026, 9, 27, 12).getTime();
        const initial = {
            ...createEmptySparkCommunityState(),
            autonomy: {
                ...createEmptySparkCommunityState().autonomy,
                enabled: true,
                minIntervalHours: 6,
                maxCallsPerDay: 1,
            },
        };
        const first = reserveSparkTrafficRun(initial, now);
        expect(first.allowed).toBe(true);
        if (!first.allowed) return;
        expect(first.state.autonomy).toMatchObject({
            lastRunAt: now,
            lastRunDay: getSparkTrafficLocalDay(now),
            callsToday: 1,
        });

        const tooSoon = reserveSparkTrafficRun(first.state, now + 60 * 60 * 1000);
        expect(tooSoon).toMatchObject({ allowed: false, reason: 'daily-cap' });

        const nextDay = now + 36 * 60 * 60 * 1000;
        const nextDayResult = reserveSparkTrafficRun(first.state, nextDay);
        expect(nextDayResult.allowed).toBe(true);
        if (nextDayResult.allowed) expect(nextDayResult.state.autonomy.callsToday).toBe(1);
    });

    it('blocks by interval before the daily cap is reached', () => {
        const now = new Date(2026, 9, 27, 12).getTime();
        const state = {
            ...createEmptySparkCommunityState(),
            autonomy: {
                ...createEmptySparkCommunityState().autonomy,
                enabled: true,
                minIntervalHours: 6,
                maxCallsPerDay: 3,
                lastRunAt: now,
                lastRunDay: getSparkTrafficLocalDay(now),
                callsToday: 1,
            },
        };
        expect(reserveSparkTrafficRun(state, now + 2 * 60 * 60 * 1000))
            .toMatchObject({ allowed: false, reason: 'interval' });
    });
});
