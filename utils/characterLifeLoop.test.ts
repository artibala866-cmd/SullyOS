// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { recordCharacterLifeEvent, readCharacterLifeEvents } from './characterLifeEvents';
import { getCurrentScheduleSlotIndex } from './scheduleTime';
import { shouldDispatchLifeEvent } from './characterLifeEventRouting';
import { classifyLifeActivity, currentLifeActivity } from './sullyLifeClock';

describe('character life loop invariants', () => {
  beforeEach(() => localStorage.clear());

  it('records persisted facts once by stable ID, preserving character boundaries', () => {
    const now = Date.now();
    const event = {
      id: 'npc-chat:thread1:1', characterId: 'char-a', kind: 'npc-chat' as const,
      occurredAt: now, source: 'phone' as const,
      summary: '已保存的微信对话：Char和同事谈了一次面试。',
    };
    expect(recordCharacterLifeEvent(event)).toBe(true);
    expect(recordCharacterLifeEvent(event)).toBe(false);
    expect(readCharacterLifeEvents('char-a')).toEqual([event]);
    expect(readCharacterLifeEvents('char-b')).toEqual([]);
  });

  it('does not route future events, other characters, or published posts into reactive loops', () => {
    const now = Date.now();
    const message = { characterId: 'char-a', kind: 'proactive-message' as const,
      occurredAt: now, summary: '已给User发了一条主动消息' };
    expect(shouldDispatchLifeEvent(message, 'char-a', now)).toBe(true);
    expect(shouldDispatchLifeEvent(message, 'char-b', now)).toBe(false);
    expect(shouldDispatchLifeEvent({ ...message, occurredAt: now + 1000 }, 'char-a', now)).toBe(false);
    expect(shouldDispatchLifeEvent({ ...message, kind: 'moment-post' }, 'char-a', now)).toBe(false);
  });

  it('parses real HH:mm schedule slots and classifies the current activity', () => {
    const slots = [
      { startTime: '08:00', activity: '上课' },
      { startTime: '13:30', activity: '工作' },
      { startTime: '23:00', activity: '睡觉' },
    ];
    const at = new Date(2026, 9, 25, 14, 15).getTime();
    expect(currentLifeActivity(slots, at)?.activity).toBe('工作');
    expect(classifyLifeActivity(currentLifeActivity(slots, at)?.activity || '')).toBe('busy');
    expect(currentLifeActivity(slots, new Date(2026, 9, 25, 1, 0).getTime())?.activity).toBe('睡觉');
    expect(getCurrentScheduleSlotIndex(slots, undefined, new Date(at))).toBe(1);
  });
});
