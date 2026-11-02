import { describe, expect, it } from 'vitest';
import { resolveRealPersonReplyReadiness as decide } from './realPersonReplyReadiness';

const now=1_800_000_000_000;
describe('real-person user-turn availability (never a random reply countdown)',()=>{
  it('a genuine saved user turn is immediately eligible when nobody is editing',()=>{
    expect(decide({activity:'free',now,lastUserSendAt:now-10_000}))
      .toEqual({kind:'ready',settleMs:0});
    expect(decide({activity:null,now,lastUserSendAt:now-10_000}))
      .toEqual({kind:'ready',settleMs:0});
  });
  it('the only short delay is settling recent input, not generating a topic',()=>{
    expect(decide({activity:'free',now,lastUserSendAt:now}))
      .toEqual({kind:'ready',settleMs:2500});
    expect(decide({activity:'free',now,lastUserSendAt:now-100_000,lastComposerActivityAt:now-600}))
      .toEqual({kind:'ready',settleMs:1900});
  });
  it('input-ended mode does not wait on a schedule timer',()=>{
    expect(decide({activity:'busy',now,attention:'normal'}).kind).toBe('ready');
    expect(decide({activity:'busy',now,attention:'occupied'}).kind).toBe('ready');
    expect(decide({activity:'sleep',now,attention:'waiting'}).kind).toBe('ready');
  });
  it('active conversation uses the same input-ended decision',()=>{
    expect(decide({activity:'busy',now,attention:'waiting',lastUserSendAt:now-10_000}))
      .toEqual({kind:'ready',settleMs:0});
    expect(decide({activity:'busy',now,attention:'conversation',lastUserSendAt:now}))
      .toEqual({kind:'ready',settleMs:2500});
  });
});
