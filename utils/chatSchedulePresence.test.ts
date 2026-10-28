import { describe, expect, it } from 'vitest';
import { resolveSchedulePresence } from './chatSchedulePresence';

describe('read-only, schedule-derived binary presence', () => {
    const now = 2_000_000;
    it('reports online for free time and offline for scheduled busy/sleep', () => {
        expect(resolveSchedulePresence('free', 0, now)).toBe('online');
        expect(resolveSchedulePresence('busy', 0, now)).toBe('offline');
        expect(resolveSchedulePresence('sleep', 0, now)).toBe('offline');
    });
    it('does not invent an offline state when a schedule is missing', () => {
        expect(resolveSchedulePresence(null, 0, now)).toBe('online');
    });
    it('real conversation outranks a conflicting old schedule, but expires', () => {
        expect(resolveSchedulePresence('busy', now - 60_000, now)).toBe('online');
        expect(resolveSchedulePresence('sleep', now - 180_000, now)).toBe('offline');
        expect(resolveSchedulePresence('busy', now + 1000, now)).toBe('offline');
    });
});
