// @vitest-environment jsdom
import {describe,it,expect,beforeEach} from 'vitest';
import {isLocalChatLeaseActive,touchLocalChatLease,LOCAL_CHAT_LEASE_TTL_MS} from './amsgChatGenerationLease';
describe('foreground real-person and Char-phone independent AI arbitration',()=>{
 beforeEach(()=>localStorage.clear());
 it('shares only a short active time, never the private message body',()=>{
   touchLocalChatLease('char',1_000_000);
   expect(isLocalChatLeaseActive('char',1_000_001)).toBe(true);
   const data=localStorage.getItem('sully_chat_reply_active_v1:char')||'';
   expect(data).toBe('1000000');
   expect(isLocalChatLeaseActive('another',1_000_001)).toBe(false);
 });
 it('expires automatically after a stopped or crashed chat window',()=>{
   touchLocalChatLease('char',1_000_000);
   expect(isLocalChatLeaseActive('char',1_000_000+LOCAL_CHAT_LEASE_TTL_MS)).toBe(false);
 });
 it('ignores missing, malformed and future leases without blocking phone activities',()=>{
   expect(isLocalChatLeaseActive('char')).toBe(false);
   localStorage.setItem('sully_chat_reply_active_v1:char','not-a-number');
   expect(isLocalChatLeaseActive('char')).toBe(false);
   touchLocalChatLease('char',1_200_000);
   expect(isLocalChatLeaseActive('char',1_000_000)).toBe(false);
 });
});
