import { describe, expect, it } from 'vitest';
import { createEmptySparkCommunityState } from './sparkCommunity';
import { getSparkTrafficLocalDay, reserveSparkTrafficRun } from './sparkTraffic';

describe('opt-in Spark autonomy budget', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0).getTime();
    it('remains disabled unless the user has opted in', () => {
        const state = createEmptySparkCommunityState();
        const result = reserveSparkTrafficRun(state, now);
        expect(result.allowed).toBe(false);
        expect(result.state).toEqual(state);
    });

    it('counts even an interrupted or failed AI call before it starts', () => {
        const initial = createEmptySparkCommunityState();
        initial.autonomy.enabled = true;
        initial.autonomy.maxCallsPerDay = 1;
        const reserved = reserveSparkTrafficRun(initial, now);
        expect(reserved.allowed).toBe(true);
        expect(reserved.state.autonomy.callsToday).toBe(1);
        expect(reserved.state.autonomy.lastRunDay).toBe(getSparkTrafficLocalDay(now));
        const again = reserveSparkTrafficRun(reserved.state, now + 1000);
        expect(again.allowed).toBe(false);
        if (!again.allowed) expect(again.reason).toBe('daily-cap');
    });

    it('enforces minimum request spacing even below the daily cap', () => {
        const initial = createEmptySparkCommunityState();
        initial.autonomy.enabled = true;
        initial.autonomy.maxCallsPerDay = 3;
        initial.autonomy.minIntervalHours = 6;
        const reserved = reserveSparkTrafficRun(initial, now);
        expect(reserved.allowed).toBe(true);
        const soon = reserveSparkTrafficRun(reserved.state, now + 5 * 60 * 60 * 1000);
        expect(soon.allowed).toBe(false);
        if (!soon.allowed) expect(soon.reason).toBe('interval');
        expect(reserveSparkTrafficRun(reserved.state, now + 7 * 60 * 60 * 1000).allowed).toBe(true);
    });

    it('resets the day budget without turning on an opted-out community', () => {
        const initial = createEmptySparkCommunityState();
        initial.autonomy.enabled = true;
        initial.autonomy.maxCallsPerDay = 1;
        initial.autonomy.callsToday = 1;
        initial.autonomy.lastRunAt = now - 48 * 60 * 60 * 1000;
        initial.autonomy.lastRunDay = getSparkTrafficLocalDay(now - 24 * 60 * 60 * 1000);
        const reservation = reserveSparkTrafficRun(initial, now);
        expect(reservation.allowed).toBe(true);
        expect(reservation.state.autonomy.callsToday).toBe(1);
    });
});
