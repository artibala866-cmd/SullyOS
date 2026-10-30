// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, DailySchedule } from '../types';
vi.mock('./dailySchedule', () => ({ getDailyScheduleForChar: vi.fn() }));
vi.mock('./scheduleGenerator', () => ({ generateDailyScheduleForChar: vi.fn() }));
import { getDailyScheduleForChar } from './dailySchedule';
import { generateDailyScheduleForChar } from './scheduleGenerator';
import { recoverForegroundDailySchedule } from './dailyScheduleForegroundRecovery';
import { getScheduleDateKey } from './scheduleTime';

const day = new Date('2026-10-30T18:00:00Z');
const char = (id = 'c1') => ({ id, scheduleFeatureEnabled: true, customTimezoneEnabled: true,
  customTimezone: 'Asia/Shanghai', scheduleStyle: 'lifestyle' }) as CharacterProfile;
const api = { apiKey: 'key', model: 'model', baseUrl: 'https://api.invalid/v1' } as any;
const make = (c = char()) => {
  let current: CharacterProfile | undefined = c;
  const onSaved = vi.fn();
  return { options: { char: c, user: { name: 'you' } as any, api,
    currentChar: () => current, onSaved }, onSaved, setChar: (next?: CharacterProfile) => { current = next; } };
};
beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.mocked(getDailyScheduleForChar).mockReset().mockResolvedValue(null);
  vi.mocked(generateDailyScheduleForChar).mockReset();
});
describe('foreground daily schedule recovery', () => {
  it('only generates for enabled characters with API, never invents past days', async () => {
    const t = make();
    const schedule = { id: 'c1_'+getScheduleDateKey(t.options.char), charId:'c1',
      date: getScheduleDateKey(t.options.char), generatedAt:Date.now(), slots:[] } as DailySchedule;
    vi.mocked(generateDailyScheduleForChar).mockResolvedValue(schedule);
    expect(await recoverForegroundDailySchedule(t.options)).toBe('generated');
    expect(t.onSaved).toHaveBeenCalledWith(schedule);
    expect(await recoverForegroundDailySchedule(t.options)).toBe('cooldown');
    expect(generateDailyScheduleForChar).toHaveBeenCalledTimes(1);
    expect(await recoverForegroundDailySchedule(make({ ...char('off'), scheduleFeatureEnabled:false }).options)).toBe('skipped');
    expect(await recoverForegroundDailySchedule({ ...make(char('no-api')).options, api: {...api, apiKey:''} })).toBe('skipped');
  });
  it('reads an existing manual schedule before reserving tokens', async () => {
    vi.mocked(getDailyScheduleForChar).mockResolvedValue({ id:'saved' } as DailySchedule);
    const t = make();
    expect(await recoverForegroundDailySchedule(t.options)).toBe('existing');
    expect(generateDailyScheduleForChar).not.toHaveBeenCalled();
  });
  it('rejects a removed or disabled Char during an in-flight model response', async () => {
    const t = make();
    let finish!: (value: DailySchedule | null) => void;
    vi.mocked(generateDailyScheduleForChar).mockImplementation((_char, _user, _api, _force, allowed) =>
      new Promise(resolve => { finish = value => {
        expect(allowed?.()).toBe(false);
        resolve(value);
      }; }));
    const pending = recoverForegroundDailySchedule(t.options);
    await vi.waitFor(() => expect(generateDailyScheduleForChar).toHaveBeenCalledTimes(1));
    t.setChar(undefined);
    finish({ id:'stale' } as DailySchedule);
    expect(await pending).toBe('failed');
    expect(t.onSaved).not.toHaveBeenCalled();
  });
  it('isolates characters and obeys the current role time zone', async () => {
    vi.mocked(generateDailyScheduleForChar).mockImplementation(async c => ({ id:c.id, charId:c.id,
      date:getScheduleDateKey(c,day), generatedAt:Date.now(), slots:[] } as DailySchedule));
    const a = make(char('alpha')); const b=make(char('beta'));
    expect(await recoverForegroundDailySchedule(a.options)).toBe('generated');
    expect(await recoverForegroundDailySchedule(b.options)).toBe('generated');
    expect(generateDailyScheduleForChar).toHaveBeenCalledTimes(2);
  });
});
