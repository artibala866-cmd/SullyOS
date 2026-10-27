// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { saveNpcProfiles } from './characterPhoneNpcs';
import { appendCharacterPhoneMessages } from './characterPhoneChats';
import { recordCharacterLifeEvent } from './characterLifeEvents';
import { findPhoneAutonomyOpportunity, markPhoneAutonomyOpportunityAttempt } from './characterPhoneOpportunity';

const now = new Date(2026, 9, 28, 12, 0, 0).getTime();
beforeEach(() => localStorage.clear());

describe('foreground phone opportunities (budget is not a scheduler)', () => {
  it('does not start an autonomous API request just because a timer tick happened', () => {
    expect(findPhoneAutonomyOpportunity('char', now)).toBeNull();
  });

  it('accepts a confirmed AMSG life event once, without changing its destination', () => {
    expect(recordCharacterLifeEvent({
      id: 'amsg-1', characterId: 'char', kind: 'proactive-message',
      source: 'amsg2', occurredAt: now - 1000, summary: 'Char sent User a message',
    })).toBe(true);
    expect(findPhoneAutonomyOpportunity('char', now)).toEqual({
      key:'event:amsg-1', kind:'life-event', eventKind:'proactive-message',
    });
    expect(markPhoneAutonomyOpportunityAttempt('char','event:amsg-1')).toBe(true);
    expect(findPhoneAutonomyOpportunity('char',now)).toBeNull();
  });

  it('rejects schedule-only assumptions, old life events and circular phone events', () => {
    recordCharacterLifeEvent({
      id:'phone-1',characterId:'char',kind:'npc-chat',source:'phone',
      occurredAt:now - 1000,summary:'A phone message was saved',
    });
    recordCharacterLifeEvent({
      id:'old',characterId:'char',kind:'activity',source:'real-mode',
      occurredAt:now - 13*60*60_000,summary:'Yesterday activity',
    });
    expect(findPhoneAutonomyOpportunity('char',now)).toBeNull();
    recordCharacterLifeEvent({
      id:'real',characterId:'char',kind:'activity',source:'real-mode',
      occurredAt:now - 1500,summary:'A confirmed real-world action',
    });
    expect(findPhoneAutonomyOpportunity('char',now)?.key).toBe('event:real');
  });

  it('prioritizes an unanswered known NPC and never fabricates a User response', () => {
    saveNpcProfiles('char',[{
      id:'npc-1',name:'阿林',identity:'friend',personality:'quiet',
      relationship:'friend',background:'old friend',source:'generated',createdAt:now-86400000,
    }]);
    const at=now-15*60_000;
    appendCharacterPhoneMessages({
      characterId:'char',contactId:'npc-1',contactName:'阿林',at,
      messages:[{speaker:{role:'contact',contactId:'npc-1'},text:'上次那件事怎么样？',createdAt:at}],
    });
    recordCharacterLifeEvent({
      id:'amsg-2',characterId:'char',kind:'proactive-message',source:'amsg2',
      occurredAt:now-1000,summary:'User-facing proactive message',
    });
    const pending=findPhoneAutonomyOpportunity('char',now);
    expect(pending?.kind).toBe('unanswered-npc');
    expect(pending?.key.startsWith('reply:')).toBe(true);
    expect(markPhoneAutonomyOpportunityAttempt('char',pending!.key)).toBe(true);
    expect(findPhoneAutonomyOpportunity('char',now)?.key).toBe('event:amsg-2');
  });

  it('never mistakes unknown/service contacts or an already answered thread for new motivation', () => {
    const at=now-12*60_000;
    appendCharacterPhoneMessages({
      characterId:'char',contactId:'unverified',contactName:'陌生人',at,
      messages:[{speaker:{role:'contact',contactId:'unverified'},text:'你好',createdAt:at}],
    });
    expect(findPhoneAutonomyOpportunity('char',now)).toBeNull();
  });
});
