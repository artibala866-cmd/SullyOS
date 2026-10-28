// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { attachCharacterLifeGlimpse, readCharacterLifeEvents, recordCharacterLifeEvent } from './characterLifeEvents';

const makeEvent = (id = 'e1') => ({
  id, characterId: 'char', kind: 'npc-chat' as const, source: 'phone' as const,
  occurredAt: 1000, summary: '真实保存的 NPC 微信交流',
});
beforeEach(() => localStorage.clear());

describe('AI life glimpse is attached to an unchanged confirmed event, not a new fact', () => {
  it('only adds a separately labelled narrative, leaving the fact and record count unchanged', () => {
    const original = makeEvent();
    expect(recordCharacterLifeEvent(original)).toBe(true);
    expect(attachCharacterLifeGlimpse(original, '当时心里有点复杂。', 1500)).toBe(true);
    const saved = readCharacterLifeEvents('char');
    expect(saved).toHaveLength(1);
    expect(saved[0].summary).toBe(original.summary);
    expect(saved[0].glimpse).toMatchObject({ text: '当时心里有点复杂。', generatedAt: 1500, anchorSummary: original.summary });
  });
  it('never resurrects explicitly cleared events', () => {
    const original = makeEvent();
    recordCharacterLifeEvent(original);
    localStorage.removeItem('sully_character_life_events_v1:char');
    expect(attachCharacterLifeGlimpse(original, '不该写回的片段')).toBe(false);
    expect(readCharacterLifeEvents('char')).toEqual([]);
  });
  it('rejects modified facts and a competing result without overwriting user data', () => {
    const original = makeEvent();
    recordCharacterLifeEvent(original);
    expect(attachCharacterLifeGlimpse({ ...original, summary: '错误引用' }, '不该落库')).toBe(false);
    expect(attachCharacterLifeGlimpse(original, '第一条真实的展开', 1600)).toBe(true);
    expect(attachCharacterLifeGlimpse(original, '第二条旧任务覆盖', 1700)).toBe(false);
    expect(readCharacterLifeEvents('char')[0].glimpse?.text).toBe('第一条真实的展开');
  });
});
