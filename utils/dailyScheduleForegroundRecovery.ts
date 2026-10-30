/** Foreground recovery for the ORIGINAL daily schedule generator.
 * No new cloud scheduler: only check today's saved plan while the OS is visible.
 * One billed attempt per Char/date per cooldown, across tabs when possible.
 */
import type { APIConfig, CharacterProfile, DailySchedule, UserProfile } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { getScheduleDateKey } from './scheduleTime';
import { isScheduleFeatureOn } from './scheduleFeature';
import { generateDailyScheduleForChar } from './scheduleGenerator';

export const FOREGROUND_SCHEDULE_RETRY_MS = 30 * 60_000;
export const FOREGROUND_SCHEDULE_ATTEMPT_PREFIX = 'sully_daily_schedule_foreground_attempt_v1:';
const localLocks = new Set<string>();
export type ForegroundScheduleResult = 'skipped' | 'existing' | 'generated' | 'cooldown' | 'failed';

export async function recoverForegroundDailySchedule(args: {
  char: CharacterProfile;
  user: UserProfile;
  api: APIConfig;
  /** Re-read from the live character list; missing or disabled means revoked. */
  currentChar: () => CharacterProfile | undefined;
  onSaved: (schedule: DailySchedule) => void;
}): Promise<ForegroundScheduleResult> {
  const { char, user, api } = args;
  if (!char?.id || !isScheduleFeatureOn(char) || !api?.apiKey || !api.baseUrl || !api.model ||
      typeof document === 'undefined' || document.visibilityState !== 'visible' ||
      typeof localStorage === 'undefined') return 'skipped';
  const day = getScheduleDateKey(char);
  const lockName = 'sully-daily-schedule:' + char.id + ':' + day;
  const allowed = () => {
    const live = args.currentChar();
    return document.visibilityState === 'visible' && !!live && live.id === char.id &&
      isScheduleFeatureOn(live) && getScheduleDateKey(live) === day &&
      live.customTimezoneEnabled === char.customTimezoneEnabled &&
      live.customTimezone === char.customTimezone &&
      live.scheduleStyle === char.scheduleStyle;
  };
  const run = async (): Promise<ForegroundScheduleResult> => {
    if (!allowed()) return 'skipped';
    try {
      if (await getDailyScheduleForChar(char)) return 'existing';
      if (!allowed()) return 'skipped';
      const key = FOREGROUND_SCHEDULE_ATTEMPT_PREFIX + char.id + ':' + day;
      const at = Date.now();
      const previous = Number(localStorage.getItem(key));
      if (Number.isFinite(previous) && previous > 0 && previous <= at &&
          at - previous < FOREGROUND_SCHEDULE_RETRY_MS) return 'cooldown';
      // Reserve before the first billable request. Failed/uncertain calls count.
      // Storage failures fail closed rather than accidentally charging repeatedly.
      localStorage.setItem(key, String(at));
      const result = await generateDailyScheduleForChar(char, user, api, false, allowed);
      if (!result || !allowed()) return 'failed';
      args.onSaved(result);
      return 'generated';
    } catch (error) {
      console.warn('[Schedule] foreground recovery skipped', error);
      return 'failed';
    }
  };
  if (localLocks.has(lockName)) return 'skipped';
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  localLocks.add(lockName);
  try {
    if (locks?.request) return await locks.request(lockName, { mode: 'exclusive' }, run);
    return await run();
  } finally { localLocks.delete(lockName); }
}
