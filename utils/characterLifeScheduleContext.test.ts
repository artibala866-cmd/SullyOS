import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./dailySchedule', () => ({ getDailyScheduleForChar: vi.fn() }));
vi.mock('./scheduleTime', () => ({ getCurrentScheduleSlotIndex: vi.fn() }));
vi.mock('./characterLifeEvents', () => ({ readCharacterLifeEvents: vi.fn() }));

import { getDailyScheduleForChar } from './dailySchedule';
import { getCurrentScheduleSlotIndex } from './scheduleTime';
import { readCharacterLifeEvents } from './characterLifeEvents';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';

const char = { id: 'char-a', customTimezoneEnabled: false, customTimezone: '' };
const now = new Date('2026-10-23T12:00:00.000Z');

beforeEach(() => { vi.resetAllMocks(); });

describe('character schedule context', () => {
  it('keeps a planned activity separate from confirmed facts', async () => {
    vi.mocked(getDailyScheduleForChar).mockResolvedValue({
      id: 'char-a_2026-10-23', charId: 'char-a', date: '2026-10-23', generatedAt: now.getTime(),
      slots: [{ startTime: '12:00', activity: '和朋友吃饭', description: '计划去餐厅' }]
    });
    vi.mocked(getCurrentScheduleSlotIndex).mockReturnValue(0);
    vi.mocked(readCharacterLifeEvents).mockReturnValue([]);
    const result = await getCharacterLifeScheduleContext(char, now);
    expect(result.plannedActivity).toBe('和朋友吃饭');
    expect(result.confirmedEvents).toEqual([]);
    expect(getDailyScheduleForChar).toHaveBeenCalledWith(char, now);
  });

  it('keeps an absent schedule distinct from confirmed activity', async () => {
    vi.mocked(getDailyScheduleForChar).mockResolvedValue(null);
    vi.mocked(readCharacterLifeEvents).mockReturnValue([
      { id: 'meal', characterId: 'char-a', kind: 'activity', occurredAt: now.getTime() - 2000, source: 'phone', summary: '已与朋友吃饭' },
    ]);
    const result = await getCharacterLifeScheduleContext(char, now);
    expect(result.plannedActivity).toBeNull();
    expect(result.plannedDescription).toBeNull();
    expect(result.confirmedEvents.map(e => e.id)).toEqual(['meal']);
  });

  it('reuses supplied events without reading the ledger and rejects other characters', async () => {
    vi.mocked(getDailyScheduleForChar).mockResolvedValue(null);
    const result = await getCharacterLifeScheduleContext(char, now, [
      { id: 'valid', characterId: 'char-a', kind: 'activity', occurredAt: now.getTime() - 1000, source: 'phone', summary: '已发生' },
      { id: 'other', characterId: 'char-b', kind: 'activity', occurredAt: now.getTime() - 1000, source: 'phone', summary: '别人的事件' },
      { id: 'future', characterId: 'char-a', kind: 'activity', occurredAt: now.getTime() + 1000, source: 'phone', summary: '未来事件' },
    ]);
    expect(result.confirmedEvents.map(e => e.id)).toEqual(['valid']);
    expect(readCharacterLifeEvents).not.toHaveBeenCalled();
  });

  it('only returns recent confirmed events belonging to this character', async () => {
    vi.mocked(getDailyScheduleForChar).mockResolvedValue(null);
    vi.mocked(readCharacterLifeEvents).mockReturnValue([
      { id: 'future', characterId: 'char-a', kind: 'activity', occurredAt: now.getTime() + 1000, source: 'phone', summary: '尚未发生' },
      { id: 'recent', characterId: 'char-a', kind: 'activity', occurredAt: now.getTime() - 1000, source: 'phone', summary: '确实发生' },
      { id: 'old', characterId: 'char-a', kind: 'activity', occurredAt: now.getTime() - 74 * 3600000, source: 'phone', summary: '过去发生' }
    ]);
    const result = await getCharacterLifeScheduleContext(char, now);
    expect(result.plannedActivity).toBeNull();
    expect(result.confirmedEvents.map(e => e.id)).toEqual(['recent']);
    expect(readCharacterLifeEvents).toHaveBeenCalledWith('char-a');
  });
});
