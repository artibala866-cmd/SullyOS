// @vitest-environment jsdom
import {beforeEach} from 'vitest';
import {recordCharacterLifeEvent} from './characterLifeEvents';
import {findPhoneAutonomyOpportunity} from './characterPhoneOpportunity';
import {describe,expect,it} from 'vitest';
import {eventForDeliveredAmsg} from './amsgPhoneEvent';
const sample={charId:'c',messageId:'msg1',source:'scheduled',messageType:'auto',
  instant:false,timestamp:123456};
describe('AMSG2 delivered private message => Char-phone life ledger',()=>{
 it('records only a real delivered autonomous contact, without copying private text',()=>{
   expect(eventForDeliveredAmsg(sample)).toEqual({
     id:'amsg2:proactive:msg1',characterId:'c',kind:'proactive-message',
     source:'amsg2',occurredAt:123456,relatedMessageId:'msg1',
     summary:'角色已经在私聊里主动联系了用户',
   });
 });
 it('never creates an activity from a planned task, instant reply, fixed reminder or failed delivery',()=>{
   expect(eventForDeliveredAmsg({...sample,source:'scheduled-pending'})).toBeNull();
   expect(eventForDeliveredAmsg({...sample,instant:true})).toBeNull();
   expect(eventForDeliveredAmsg({...sample,messageType:'fixed'})).toBeNull();
   expect(eventForDeliveredAmsg({...sample,messageId:''})).toBeNull();
 });
});

describe('real delivered AMSG2 remains a history receipt',()=>{
 beforeEach(()=>localStorage.clear());
 it('records the receipt once without making it a phone opportunity',()=>{
   const event=eventForDeliveredAmsg({
     charId:'phone-link',messageId:'provider-xyz',source:'scheduled',
     messageType:'auto',instant:false,timestamp:Date.now()-1000,
   });
   expect(event).not.toBeNull();
   expect(recordCharacterLifeEvent(event!)).toBe(true);
   // Same delivered message reappears after inbox retry: strictly idempotent.
   expect(recordCharacterLifeEvent(event!)).toBe(false);
   expect(findPhoneAutonomyOpportunity('phone-link',Date.now())).toBeNull();
 });
});