import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./dailySchedule', () => ({ getDailyScheduleForChar: vi.fn() }));
vi.mock('./characterLifeEvents', () => ({ readCharacterLifeEvents: vi.fn() }));

import { getDailyScheduleForChar } from './dailySchedule';
import { readCharacterLifeEvents } from './characterLifeEvents';
import { getCharacterLifeScheduleContext } from './characterLifeScheduleContext';

const char = { id: 'char-a', scheduleFeatureEnabled: true, customTimezoneEnabled: true, customTimezone: 'UTC' };
const now = new Date('2026-10-23T12:00:00.000Z');

beforeEach(() => { vi.resetAllMocks(); });

describe('character schedule context', () => {
  it('keeps a planned activity separate from confirmed facts', async () => {
    vi.mocked(getDailyScheduleForChar).mockResolvedValue({
      id: 'char-a_2026-10-23', charId: 'char-a', date: '2026-10-23', generatedAt: now.getTime(),
      slots: [{ startTime: '12:00', activity: '和朋友吃饭', description: '计划去餐厅' }]
    });
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


it('a disabled schedule contributes no old plan but keeps confirmed events', async () => {
  vi.mocked(getDailyScheduleForChar).mockResolvedValue({slots:[{startTime:'12:00',activity:'旧计划'}]} as any);
  vi.mocked(readCharacterLifeEvents).mockReturnValue([{id:'done',characterId:char.id,kind:'activity',source:'phone',occurredAt:now.getTime()-100,summary:'已保存事实'}]);
  const result=await getCharacterLifeScheduleContext({...char,scheduleFeatureEnabled:false},now);
  expect(getDailyScheduleForChar).not.toHaveBeenCalled();
  expect(result.plannedActivity).toBeNull();
  expect(result.confirmedEvents.map(e=>e.id)).toEqual(['done']);
});

it('uses the role-local phase, then expires it at the next block without recording an event', async () => {
  vi.mocked(getDailyScheduleForChar).mockResolvedValue({
    id: 'char-a_2026-10-23', charId: char.id, date: '2026-10-23', generatedAt: now.getTime(),
    slots: [
      { startTime: '09:00', activity: '画稿', availability: 'focused', steps: [
        { startTime: '10:00', activity: '离开画室', availability: 'away' },
        { startTime: '12:00', activity: '越界阶段', availability: 'offline' },
      ] },
      { startTime: '11:00', activity: '吃午饭', availability: 'available' },
    ],
  });
  const target = { ...char, customTimezone: 'Asia/Tokyo' };
  expect(await getCharacterLifeScheduleContext(target, new Date('2026-10-23T01:30:00Z'), []))
    .toMatchObject({ plannedActivity: '离开画室', plannedAvailability: 'away', confirmedEvents: [] });
  expect(await getCharacterLifeScheduleContext(target, new Date('2026-10-23T03:00:00Z'), []))
    .toMatchObject({ plannedActivity: '吃午饭', plannedAvailability: 'available', confirmedEvents: [] });
});
