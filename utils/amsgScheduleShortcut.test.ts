import { describe, expect, it } from 'vitest';
import { suggestNextFreeScheduleSendAt } from './amsgScheduleShortcut';

const owner = { customTimezoneEnabled: true, customTimezone: 'Asia/Shanghai' };
const slots = [
    { startTime: '08:00', activity: '上班' },
    { startTime: '12:00', activity: '休息' },
    { startTime: '14:00', activity: '开会' },
    { startTime: '18:00', activity: '吃饭' },
];

describe('one-tap AMSG2 schedule shortcut', () => {
    it('picks the next free slot in the character timezone, not the device timezone', () => {
        const now = Date.parse('2026-10-29T02:00:00Z'); // 10:00 in Shanghai
        expect(suggestNextFreeScheduleSendAt(slots, owner, now))
            .toBe(Date.parse('2026-10-29T04:00:00Z'));
    });
    it('when already free, schedules shortly later without crossing a busy transition', () => {
        const now = Date.parse('2026-10-29T04:10:00Z'); // 12:10 free
        expect(suggestNextFreeScheduleSendAt(slots, owner, now)).toBe(now + 15 * 60_000);
        const nearBusy = Date.parse('2026-10-29T05:55:00Z'); // 13:55
        expect(suggestNextFreeScheduleSendAt(slots, owner, nearBusy))
            .toBe(Date.parse('2026-10-29T10:00:00Z')); // next free 18:00
    });
    it('does not fabricate a schedule or another day', () => {
        const late = Date.parse('2026-10-29T16:30:00Z'); // next day 00:30 Shanghai
        expect(suggestNextFreeScheduleSendAt([], owner, late)).toBeNull();
        const night = Date.parse('2026-10-29T15:45:00Z'); // 23:45 Shanghai, free but 15 min crosses midnight
        expect(suggestNextFreeScheduleSendAt(slots, owner, night)).toBeNull();
    });
});
