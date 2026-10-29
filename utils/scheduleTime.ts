import type { CharacterProfile, ScheduleSlot } from '../types';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, resolveCharTimeZone } from './timezone';

type ScheduleCharacter = Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone'>;

/** 当前绝对时刻 → 角色所在地的墙上时间；未启用自定义时区时跟随设备。 */
export const getScheduleWallClock = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): Date => nowInTimeZone(resolveCharTimeZone(char), base);

/** 角色所在地的日历日 key。 */
export const getScheduleDateKey = (
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): string => getLocalDateKey(getScheduleWallClock(char, base));

/** Only valid wall-clock times can influence schedule-based chat presence. */
export const parseScheduleStartMinutes = (value: unknown): number | null => {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    return hour >= 0 && hour < 24 ? hour * 60 + Number(match[2]) : null;
};

/** Sort a saved/edited daily plan without mutating the original slot array.
 * Invalid legacy slot times are kept at the end and never match current presence.
 */
export const sortScheduleSlots = (slots: ScheduleSlot[]): ScheduleSlot[] =>
    [...slots].sort((a, b) =>
        (parseScheduleStartMinutes(a.startTime) ?? Number.POSITIVE_INFINITY)
        - (parseScheduleStartMinutes(b.startTime) ?? Number.POSITIVE_INFINITY));

/** Midnight rollover is measured in the character's calendar, not the phone's. */
export const isSameScheduleCalendarDay = (
    char: ScheduleCharacter | null | undefined,
    startedAt: Date,
    finishedAt: Date,
): boolean => getScheduleDateKey(char, startedAt) === getScheduleDateKey(char, finishedAt);

/** 按角色所在地的当前时间，找到已经开始的最后一条日程。 */
export const getCurrentScheduleSlotIndex = (
    slots: ScheduleSlot[],
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): number => {
    const now = getScheduleWallClock(char, base);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    // Older persisted plans or imported schedules can be out of order.
    // Select the latest *clock time*, while returning the original array index
    // needed by schedule cards, editors and the private-chat presence gate.
    let index = -1;
    let latestMinute = -1;
    for (let i = 0; i < slots.length; i++) {
        const minute = parseScheduleStartMinutes(slots[i].startTime);
        if (minute !== null && minute <= currentMinutes && minute >= latestMinute) {
            index = i;
            latestMinute = minute;
        }
    }
    return index;
};

/** Before today's first slot, the current activity is unknown, not today's last slot. */
export const getCurrentScheduleActivity = (
    slots: ScheduleSlot[],
    char?: ScheduleCharacter | null,
    base: Date = new Date(),
): string | null => {
    const index = getCurrentScheduleSlotIndex(slots, char, base);
    const activity = index >= 0 ? slots[index]?.activity?.trim() : '';
    return activity || null;
};
