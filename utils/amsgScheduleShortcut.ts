/** One-tap suggestion for the EXISTING AMSG2 datetime-local field.
 * This only PREFILLS a time when the user clicks; it creates no job and calls no AI.
 * A plan is never treated as an event or a promise that the character will speak.
 */
import type { CharacterProfile, ScheduleSlot } from '../types';
import { classifyLifeActivity } from './sullyLifeClock';
import { getScheduleDateKey, getScheduleWallClock } from './scheduleTime';
import { resolveCharTimeZone, wallClockToTimestamp } from './timezone';

type ScheduleOwner = Pick<CharacterProfile, 'customTimezoneEnabled' | 'customTimezone'>;
const MIN_LEAD_MS = 10 * 60_000;
const ACTIVE_FREE_DELAY_MS = 15 * 60_000;

export function suggestNextFreeScheduleSendAt(
    slots: readonly Pick<ScheduleSlot, 'startTime' | 'activity'>[],
    owner: ScheduleOwner,
    now = Date.now(),
): number | null {
    if (!slots.length || !Number.isFinite(now)) return null;
    const today = getScheduleDateKey(owner, new Date(now));
    const tz = resolveCharTimeZone(owner);
    const wall = getScheduleWallClock(owner, new Date(now));
    const minute = wall.getHours() * 60 + wall.getMinutes();
    const valid = slots.map(s => {
        const match = /^(\d{1,2}):(\d{2})$/.exec(s.startTime);
        if (!match) return null;
        const hour = Number(match[1]), min = Number(match[2]);
        if (hour > 23 || min > 59) return null;
        return { ...s, minute: hour * 60 + min };
    }).filter((s): s is { startTime: string; activity: string; minute: number } => s !== null)
      .sort((a, b) => a.minute - b.minute);
    if (!valid.length) return null;

    // If already free, use a small human-friendly gap only if it doesn't
    // cross into a later busy/sleep slot.
    const current = [...valid].reverse().find(s => s.minute <= minute);
    const next = valid.find(s => s.minute > minute);
    if (current && classifyLifeActivity(current.activity) === 'free') {
        const candidate = now + ACTIVE_FREE_DELAY_MS;
        const wallCandidate = getScheduleWallClock(owner, new Date(candidate));
        if (getScheduleDateKey(owner, new Date(candidate)) === today
            && (!next || wallCandidate.getHours() * 60 + wallCandidate.getMinutes() < next.minute)) return candidate;
    }
    // Only use today's *actual* future free slot; never claim tomorrow's
    // timetable exists or create a hidden recurring task.
    for (const slot of valid) {
        if (slot.minute <= minute || classifyLifeActivity(slot.activity) !== 'free') continue;
        const when = wallClockToTimestamp(today + ' ' + slot.startTime + ':00', tz);
        if (Number.isFinite(when) && when >= now + MIN_LEAD_MS
            && getScheduleDateKey(owner, new Date(when)) === today) return when;
    }
    return null;
}
