import type { CharacterProfile, ScheduleAvailability, ScheduleSlot, ScheduleStep } from '../types';
import { classifyLifeActivity } from './sullyLifeClock';
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

export const SCHEDULE_AVAILABILITY_LABELS: Record<ScheduleAvailability, string> = {
    available: '空闲', focused: '专注', away: '暂离', offline: '离线', asleep: '睡眠',
};

export function parseScheduleAvailability(value: unknown): ScheduleAvailability | undefined {
    return typeof value === 'string' && Object.hasOwn(SCHEDULE_AVAILABILITY_LABELS, value)
        ? value as ScheduleAvailability : undefined;
}

export function parseScheduleSteps(value: unknown): ScheduleStep[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const steps: ScheduleStep[] = [];
    for (const row of value.slice(0, 6)) {
        if (!row || parseScheduleStartMinutes(row.startTime) === null ||
            typeof row.activity !== 'string' || !row.activity.trim()) continue;
        steps.push({ startTime: row.startTime.trim(), activity: row.activity.trim().slice(0, 80),
            availability: parseScheduleAvailability(row.availability) });
    }
    return steps.length ? steps : undefined;
}

/** Resolve one block and its live step using the same role-local wall clock. */
export function resolveSchedulePhase(slots: ScheduleSlot[], wallClock: Date) {
    const minute = wallClock.getHours() * 60 + wallClock.getMinutes();
    const timeline = sortScheduleSlots(slots).filter(slot => parseScheduleStartMinutes(slot.startTime) !== null);
    const next = timeline.find(slot => parseScheduleStartMinutes(slot.startTime)! > minute);
    const block = [...timeline].reverse().find(slot => parseScheduleStartMinutes(slot.startTime)! <= minute);
    if (!block) return { block, step: undefined, next, availability: null };
    const start = parseScheduleStartMinutes(block.startTime)!;
    const end = next ? parseScheduleStartMinutes(next.startTime)! : 1440;
    const step = parseScheduleSteps(block.steps)?.filter(row => {
        const at = parseScheduleStartMinutes(row.startTime)!;
        return at >= start && at < end && at <= minute;
    }).sort((a, b) => parseScheduleStartMinutes(a.startTime)! - parseScheduleStartMinutes(b.startTime)!).at(-1);
    const inferred = classifyLifeActivity(step?.activity ?? block.activity);
    const availability = step?.availability ?? parseScheduleAvailability(block.availability)
        ?? (inferred === 'sleep' ? 'asleep' : inferred === 'busy' ? 'focused' : 'available');
    return { block, step, next, availability };
}

export function getPlannedAvailability(life: {
    plannedAvailability?: ScheduleAvailability | null;
    plannedActivity: string | null;
}): ScheduleAvailability {
    if (life.plannedAvailability) return life.plannedAvailability;
    const legacy = classifyLifeActivity(life.plannedActivity ?? '');
    return legacy === 'sleep' ? 'asleep' : legacy === 'busy' ? 'focused' : 'available';
}
