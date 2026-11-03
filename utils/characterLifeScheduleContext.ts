import { isScheduleFeatureOn } from './scheduleFeature';
import type { CharacterProfile, ScheduleAvailability } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { getScheduleWallClock, resolveSchedulePhase } from './scheduleTime';
import { readCharacterLifeEvents } from './characterLifeEvents';

type LifeScheduleContext = {
  characterId: string;
  observedAt: number;
  plannedActivity: string | null;
  plannedDescription: string | null;
  plannedAvailability?: ScheduleAvailability | null;
  confirmedEvents: ReturnType<typeof readCharacterLifeEvents>;
};

/** Read-only snapshot: a schedule is a plan, not proof that an activity occurred. */
export async function getCharacterLifeScheduleContext(
  char: Pick<CharacterProfile, 'id' | 'customTimezoneEnabled' | 'customTimezone' | 'scheduleFeatureEnabled' | 'scheduleStyle'>,
  at: Date = new Date(),
  confirmedEvents?: ReturnType<typeof readCharacterLifeEvents>,
): Promise<LifeScheduleContext> {
  const schedule = isScheduleFeatureOn(char) ? await getDailyScheduleForChar(char, at) : null;
  const phase = schedule ? resolveSchedulePhase(schedule.slots, getScheduleWallClock(char, at)) : null;
  const slot = phase?.block;
  const now = at.getTime();
  return {
    characterId: char.id,
    observedAt: now,
    plannedActivity: phase?.step?.activity ?? slot?.activity ?? null,
    plannedAvailability: phase?.availability ?? null,
    plannedDescription: slot?.description ?? null,
    confirmedEvents: (confirmedEvents ?? readCharacterLifeEvents(char.id)).filter(
      event => event.characterId === char.id && Number.isFinite(event.occurredAt) && event.occurredAt <= now && now - event.occurredAt < 72 * 60 * 60 * 1000
    ).slice(0, 20),
  };
}
