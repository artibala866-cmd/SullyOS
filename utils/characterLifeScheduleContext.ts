import type { CharacterProfile } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { getCurrentScheduleSlotIndex } from './scheduleTime';
import { readCharacterLifeEvents } from './characterLifeEvents';

/** Read-only snapshot: a schedule is a plan, not proof that an activity occurred. */
export async function getCharacterLifeScheduleContext(
  char: Pick<CharacterProfile, 'id' | 'customTimezoneEnabled' | 'customTimezone'>,
  at: Date = new Date(),
  confirmedEvents?: ReturnType<typeof readCharacterLifeEvents>,
) {
  const schedule = await getDailyScheduleForChar(char, at);
  const index = schedule ? getCurrentScheduleSlotIndex(schedule.slots, char, at) : -1;
  const slot = index >= 0 ? schedule?.slots[index] : undefined;
  const now = at.getTime();
  return {
    characterId: char.id,
    observedAt: now,
    plannedActivity: slot?.activity ?? null,
    plannedDescription: slot?.description ?? null,
    confirmedEvents: (confirmedEvents ?? readCharacterLifeEvents(char.id)).filter(
      event => event.characterId === char.id && Number.isFinite(event.occurredAt) && event.occurredAt <= now && now - event.occurredAt < 72 * 60 * 60 * 1000
    ).slice(0, 20),
  };
}
