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
      .toEqual({kind:'ready',settleMs:1250});
    expect(decide({activity:'free',now,lastUserSendAt:now-100_000,lastComposerActivityAt:now-600}))
      .toEqual({kind:'ready',settleMs:650});
  });
  it('being busy or asleep waits for real schedule availability, not the clock',()=>{
    expect(decide({activity:'busy',now,attention:'normal'}).kind).toBe('wait-availability');
    expect(decide({activity:'busy',now,attention:'occupied'}).kind).toBe('wait-availability');
    expect(decide({activity:'sleep',now,attention:'waiting'}).kind).toBe('wait-availability');
  });
  it('real active conversation may continue while busy but cannot override sleep',()=>{
    expect(decide({activity:'busy',now,attention:'waiting',lastUserSendAt:now-10_000}))
      .toEqual({kind:'ready',settleMs:0});
    expect(decide({activity:'busy',now,attention:'conversation',lastUserSendAt:now}))
      .toEqual({kind:'ready',settleMs:1250});
  });
});
