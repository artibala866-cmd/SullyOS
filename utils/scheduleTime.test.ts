import { afterAll, describe, expect, it } from 'vitest';
import type { CharacterProfile, ScheduleSlot } from '../types';
import {
    getCurrentScheduleSlotIndex,
    getCurrentScheduleActivity,
    parseScheduleStartMinutes,
    sortScheduleSlots,
    isSameScheduleCalendarDay,
    getScheduleDateKey,
    getScheduleWallClock,
} from './scheduleTime';

const originalTimeZone = process.env.TZ;

afterAll(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
});

const losAngelesChar = {
    customTimezoneEnabled: true,
    customTimezone: 'America/Los_Angeles',
} as CharacterProfile;

const slots: ScheduleSlot[] = [
    { startTime: '08:00', activity: '早餐' },
    { startTime: '12:00', activity: '午餐' },
    { startTime: '18:00', activity: '晚饭' },
];

describe('character schedule clock', () => {
    it('uses the character wall clock for date, time and current-slot ordering', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T16:30:00.000Z');
        const wallClock = getScheduleWallClock(losAngelesChar, instant);

        expect(getScheduleDateKey(losAngelesChar, instant)).toBe('2026-07-20');
        expect([wallClock.getHours(), wallClock.getMinutes()]).toEqual([9, 30]);
        expect(getCurrentScheduleSlotIndex(slots, losAngelesChar, instant)).toBe(0);
    });

    it('falls back to the phone clock when custom timezone is disabled', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T16:30:00.000Z'); // 手机 7/21 00:30
        const disabled = {
            ...losAngelesChar,
            customTimezoneEnabled: false,
        };

        expect(getScheduleDateKey(disabled, instant)).toBe('2026-07-21');
        expect(getCurrentScheduleSlotIndex(slots, disabled, instant)).toBe(-1);
    });

    it('before the first slot does not claim the last sleep activity', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T08:30:00Z'); // LA 01:30
        const day = [...slots, { startTime: '23:00', activity: '睡觉' }];
        expect(getCurrentScheduleSlotIndex(day, losAngelesChar, instant)).toBe(-1);
        expect(getCurrentScheduleActivity(day, losAngelesChar, instant)).toBeNull();
    });

    it('invalid or blank times never create a fictional current activity', () => {
        const instant = new Date('2026-07-20T16:30:00Z'); // LA 09:30
        expect(getCurrentScheduleActivity([], losAngelesChar, instant)).toBeNull();
        expect(getCurrentScheduleActivity([{ startTime: 'bad', activity: '睡觉' }], losAngelesChar, instant)).toBeNull();
        expect(getCurrentScheduleActivity([{ startTime: '08:00', activity: '  ' }], losAngelesChar, instant)).toBeNull();
        expect(parseScheduleStartMinutes('24:00')).toBeNull();
        expect(parseScheduleStartMinutes('08:60')).toBeNull();
        expect(parseScheduleStartMinutes('08:00:00')).toBeNull();
        expect(parseScheduleStartMinutes('8:05')).toBe(485);
    });

    it('moves a manually edited morning slot to evening without altering its content', () => {
        const original: ScheduleSlot[] = [
            { startTime: '21:00', activity: '原来的晨读', description: '练习' },
            { startTime: '12:00', activity: '午餐' },
            { startTime: '18:00', activity: '晚饭' },
        ];
        const sorted = sortScheduleSlots(original);
        expect(sorted.map(x => x.startTime)).toEqual(['12:00', '18:00', '21:00']);
        expect(sorted[2].description).toBe('练习');
        expect(original[0].startTime).toBe('21:00');
        const instant = new Date('2026-07-20T20:00:00Z'); // LA 13:00
        expect(getCurrentScheduleSlotIndex(sorted, losAngelesChar, instant)).toBe(0);
        expect(getCurrentScheduleActivity(sorted, losAngelesChar, instant)).toBe('午餐');
    });

    it('midnight and DST are measured against the character calendar, not the phone', () => {
        process.env.TZ = 'Asia/Shanghai';
        expect(isSameScheduleCalendarDay(losAngelesChar,
            new Date('2026-07-21T06:59:00Z'), new Date('2026-07-21T07:01:00Z'))).toBe(false);
        // LA daylight-saving fall-back repeats 01:30 but remains the same day.
        expect(isSameScheduleCalendarDay(losAngelesChar,
            new Date('2026-11-01T08:30:00Z'), new Date('2026-11-01T09:30:00Z'))).toBe(true);
        const local = { ...losAngelesChar, customTimezoneEnabled: false };
        expect(isSameScheduleCalendarDay(local,
            new Date('2026-07-20T15:59:00Z'), new Date('2026-07-20T16:01:00Z'))).toBe(false);
    });

    it('legacy unsorted plans agree with the cloud current-slot selection', () => {
        process.env.TZ = 'Asia/Shanghai';
        const instant = new Date('2026-07-20T23:30:00Z'); // LA 16:30
        const unsorted: ScheduleSlot[] = [
            { startTime: '22:00', activity: '睡觉' },
            { startTime: '15:00', activity: '散步' },
            { startTime: '08:00', activity: '工作' },
            { startTime: '18:99', activity: '错误时间' },
        ];
        expect(getCurrentScheduleSlotIndex(unsorted, losAngelesChar, instant)).toBe(1);
        expect(getCurrentScheduleActivity(unsorted, losAngelesChar, instant)).toBe('散步');
    });

    it('ignores malformed slot times instead of selecting them', () => {
        const instant = new Date('2026-07-20T16:30:00.000Z');
        expect(getCurrentScheduleSlotIndex([
            { startTime: 'not-a-time', activity: '坏数据' },
            ...slots,
        ], losAngelesChar, instant)).toBe(1);
    });
});
