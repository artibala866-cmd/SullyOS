import { describe, expect, it } from 'vitest';
import type { CharacterLifeEvent } from './characterLifeEvents';
import { selectConfirmedLifeGlimpses } from './characterLifeGlimpses';

const event = (id: string, occurredAt: number, source: CharacterLifeEvent['source'] = 'phone'): CharacterLifeEvent =>
  ({ id, characterId: 'char-a', kind: 'npc-chat', source, occurredAt, summary: id + ' 确实已记录' });

describe('confirmed life glimpse projection', () => {
  it('reads saved phone and AMSG facts chronologically without manufacturing messages', () => {
    const input = [event('phone-msg', 6000), event('proactive', 9000, 'amsg2')];
    const selected = selectConfirmedLifeGlimpses(input, 'char-a', 10000);
    expect(selected.map(e => e.id)).toEqual(['proactive','phone-msg']);
    expect(selected[0].source).toBe('amsg2');
    expect(input.map(e => e.id)).toEqual(['phone-msg','proactive']);
  });
  it('rejects future events, invalid time and other character records', () => {
    const other = { ...event('other', 7000), characterId: 'char-b' };
    const blank = { ...event('blank', 7000), summary: ' ' };
    const selected = selectConfirmedLifeGlimpses([event('future', 11000),other,blank,event('valid', 9000)], 'char-a', 10000);
    expect(selected.map(e => e.id)).toEqual(['valid']);
  });
  it('deduplicates persisted ids and respects an empty ledger after a user clear', () => {
    const list = [event('one', 8000), event('one', 8000), event('two', 6000)];
    expect(selectConfirmedLifeGlimpses(list, 'char-a', 10000, 1).map(e => e.id)).toEqual(['one']);
    expect(selectConfirmedLifeGlimpses([], 'char-a', 10000)).toEqual([]);
    expect(selectConfirmedLifeGlimpses(list, '', 10000)).toEqual([]);
  });
});
