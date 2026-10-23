import { describe, expect, it } from 'vitest';
import { getLifeEventConsumers, shouldDispatchLifeEvent } from './characterLifeEventRouting';

const now = 1_800_000_000_000;
const event = { characterId: 'char-a', kind: 'npc-chat' as const, occurredAt: now - 1000, summary: '和朋友聊天' };

describe('character life event routing', () => {
  it('routes confirmed NPC interactions to existing consumers', () => {
    expect(getLifeEventConsumers('npc-chat')).toEqual(['moments', 'memo']);
    expect(shouldDispatchLifeEvent(event, 'char-a', now)).toBe(true);
  });
  it('does not recursively generate from its own published posts', () => {
    expect(getLifeEventConsumers('moment-post')).toEqual([]);
    expect(getLifeEventConsumers('moment-comment')).toEqual([]);
    expect(shouldDispatchLifeEvent({ ...event, kind: 'moment-post' }, 'char-a', now)).toBe(false);
  });
  it('rejects another character, future plans, stale events and empty facts', () => {
    expect(shouldDispatchLifeEvent(event, 'char-b', now)).toBe(false);
    expect(shouldDispatchLifeEvent({ ...event, occurredAt: now + 1 }, 'char-a', now)).toBe(false);
    expect(shouldDispatchLifeEvent({ ...event, occurredAt: now - 73 * 3600_000 }, 'char-a', now)).toBe(false);
    expect(shouldDispatchLifeEvent({ ...event, summary: ' ' }, 'char-a', now)).toBe(false);
  });
  it('only asks memo to consider new contacts', () => {
    expect(getLifeEventConsumers('contact-added')).toEqual(['memo']);
  });
});
