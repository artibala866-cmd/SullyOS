// @vitest-environment jsdom
import {beforeEach,describe,it,expect} from 'vitest';
import {recordCharacterLifeEvent,pruneDeletedPrivateChatLifeEvents,readCharacterLifeEvents} from './characterLifeEvents';
beforeEach(()=>localStorage.clear());
describe('private-chat deletion revokes only facts derived from the deleted cloud message',()=>{
 const ev=(id:string,source:'amsg2'|'xiaohongshu'|'phone'|'real-mode',relatedMessageId?:string)=>({
  id,characterId:'c',occurredAt:1000,kind:'proactive-message' as const,
  source,summary:'already confirmed',relatedMessageId,
 });
 it('removes cloud contact and verified XHS from the deleted private message, keeps NPC and independent life',()=>{
  [ev('chat','amsg2','provider-1'),ev('xhs','xiaohongshu','provider-1'),
   ev('npc','phone','provider-1'),ev('other','real-mode','provider-1'),
   ev('live','amsg2','provider-2')].forEach(e=>recordCharacterLifeEvent(e));
  expect(pruneDeletedPrivateChatLifeEvents('c',['provider-1'])).toBe(2);
  expect(readCharacterLifeEvents('c').map(e=>e.id).sort()).toEqual(['live','npc','other']);
 });
 it('never revokes anything on unrelated or unknown provider ids',()=>{
  recordCharacterLifeEvent(ev('chat','amsg2','provider-1'));
  expect(pruneDeletedPrivateChatLifeEvents('c',['not-that-message'])).toBe(0);
  expect(pruneDeletedPrivateChatLifeEvents('c',[])).toBe(0);
  expect(readCharacterLifeEvents('c')).toHaveLength(1);
 });
});
