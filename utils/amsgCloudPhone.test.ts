import { describe, expect, it } from 'vitest';
import {
  CLOUD_PHONE_RESULT_KIND, CLOUD_PHONE_STATE_KEY,
  cloudPhoneInstruction, cloudPhoneReplyId,
  extractCloudPhoneReply, isCloudPhoneOpportunityFresh, parseCloudPhoneResult,
  readCloudPhoneAttemptIds, rememberCloudPhoneAttempt,
  type CloudPhoneOpportunity,
} from './amsgCloudPhone';

const now=Date.parse('2026-10-30T12:00:00Z');
const o:CloudPhoneOpportunity={contactId:'npc-1',contactName:'小圆',threadId:'t1',
  sourceKey:'reply:t1:'+(now-20*60000)+':1',
  replyToAt:now-20*60000,replyToCount:1,replyToText:'在忙吗',
  revision:2,clearRevision:0,history:[{speaker:'contact',text:'在忙吗'}]};
describe('stage4 optional cloud NPC side effect (no independent LLM request)',()=>{
  it('only consumes fresh grounded unanswered inbox context',()=>{
    expect(isCloudPhoneOpportunityFresh(o,now)).toBe(true);
    expect(isCloudPhoneOpportunityFresh(o,now+73*3600_000)).toBe(false);
    expect(isCloudPhoneOpportunityFresh({...o,replyToAt:now-1000},now)).toBe(false);
    expect(cloudPhoneInstruction(o)).toContain('在忙吗');
  });
  it('keeps recent cloud reply reservations across distinct NPC threads',()=>{
    const first=cloudPhoneReplyId('role',o);
    const second=cloudPhoneReplyId('role',{...o,threadId:'another',sourceKey:'reply:another:1:1'});
    const previous=rememberCloudPhoneAttempt(null,first);
    const after=rememberCloudPhoneAttempt(previous,second);
    expect(readCloudPhoneAttemptIds(after)).toEqual([first,second]);
    expect(readCloudPhoneAttemptIds(rememberCloudPhoneAttempt(after,first))).toEqual([second,first]);
    expect(readCloudPhoneAttemptIds(first)).toEqual([first]); // legacy scalar
  });
  it('same saved inbound yields a stable cloud reservation ID across retries',()=>{
    const id=cloudPhoneReplyId('role',o);
    expect(id).toBe(cloudPhoneReplyId('role',o));
    expect(id).not.toBe(cloudPhoneReplyId('other',o));
    expect(CLOUD_PHONE_STATE_KEY.length).toBeGreaterThan(0);
    expect(id).not.toContain('在忙吗');
  });
  it('strips internal phone JSON and preserves user-facing conversation independently',()=>{
    const raw='我去散散步。\n[[CLOUD_PHONE_REPLY:{"messages":["刚忙完","怎么啦"]}]]';
    expect(extractCloudPhoneReply(raw,true)).toEqual({content:'我去散散步。',messages:['刚忙完','怎么啦']});
    expect(extractCloudPhoneReply(raw,false)).toEqual({content:'我去散散步。',messages:[]});
    expect(extractCloudPhoneReply('[[CLOUD_PHONE_REPLY:{"messages":["嗯"]}]]',true))
      .toEqual({content:'[[SILENT]]',messages:['嗯']});
  });
  it('never leaks malformed or oversize internal directives into user push',()=>{
    const x=extractCloudPhoneReply('打招呼\n[[CLOUD_PHONE_REPLY:invalid]]',true);
    expect(x).toEqual({content:'打招呼',messages:[]});
    expect(extractCloudPhoneReply('[[CLOUD_PHONE_REPLY:unfinished',false))
      .toEqual({content:'[[SILENT]]',messages:[]});
    const tooLong='x'.repeat(161);
    expect(extractCloudPhoneReply('[[CLOUD_PHONE_REPLY:{"messages":["'+tooLong+'"]}]]',true).messages)
      .toEqual([]);
  });
  it('rejects malformed results, arbitrary kinds, and invalid text limits',()=>{
    const result={resultKind:CLOUD_PHONE_RESULT_KIND,charId:'role',
      id:'cloud-npc:abcd',contactId:'npc-1',threadId:'t1',sourceKey:o.sourceKey,
      replyToAt:o.replyToAt,replyToCount:1,replyToText:o.replyToText,
      revision:2,clearRevision:0,occurredAt:now,messages:['嗯']};
    expect(parseCloudPhoneResult(result)).toEqual(result);
    expect(parseCloudPhoneResult({...result,resultKind:'other'})).toBeNull();
    expect(parseCloudPhoneResult({...result,messages:['']})).toBeNull();
    expect(parseCloudPhoneResult({...result,contactId:''})).toBeNull();
  });
});
