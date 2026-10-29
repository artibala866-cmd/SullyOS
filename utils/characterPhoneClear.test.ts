// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {clearSelectedPhoneData,PHONE_CLEAR_GROUPS} from './characterPhoneClear';
import {readCharacterPhoneChats} from './characterPhoneChats';
import {readPhoneContentClearRevision} from './characterPhoneContentClearRevision';
import {recordCharacterLifeEvent,readCharacterLifeEvents} from './characterLifeEvents';
beforeEach(()=>localStorage.clear());
describe('selective Char phone cleanup',()=>{
 it('deletes only selected categories for one Char, retaining real DB and music keys',()=>{
  const id='owner';
  const setup=(k:string)=>localStorage.setItem(k+id,'[]');
  setup('sully_character_memo_entries_v1:');
  setup('sully_character_phone_browser_v1:');
  setup('sully_character_phone_wechat_v1:');
  localStorage.setItem('sully_character_memo_entries_v1:other','[]');
  localStorage.setItem('sully_character_phone_wallet_v1:'+id,'wallet');
  localStorage.setItem('sully_music_cfg_v1','music config');
  localStorage.setItem('sully_character_avatar_library_v1:'+id,'photos');
  const result=clearSelectedPhoneData(id,['memos','browser']);
  expect(result).toEqual(['memos','browser']);
  expect(localStorage.getItem('sully_character_memo_entries_v1:'+id)).toBeNull();
  // Browser's canonical clear writes an empty [] and dispatches its change event.
  expect(localStorage.getItem('sully_character_phone_browser_v1:'+id)).toBe('[]');
  expect(localStorage.getItem('sully_character_phone_wechat_v1:'+id)).toBe('[]');
  expect(localStorage.getItem('sully_character_phone_wallet_v1:'+id)).toBe('wallet');
  expect(localStorage.getItem('sully_character_memo_entries_v1:other')).toBe('[]');
  expect(localStorage.getItem('sully_music_cfg_v1')).toBe('music config');
  expect(localStorage.getItem('sully_character_avatar_library_v1:'+id)).toBe('photos');
 });
 it('clears only official account threads without deleting NPC conversations',()=>{
  const id='owner';
  const rows=[
   {id:'npc1',contactId:'npc-1',name:'朋友',preview:'你好',time:1,messages:[]},
   {id:'payment',contactId:'service:微信支付',kind:'service',name:'微信支付',preview:'账单',time:2,messages:[]},
  ];
  localStorage.setItem('sully_character_phone_wechat_v1:'+id,JSON.stringify(rows));
  clearSelectedPhoneData(id,['service']);
  expect(readCharacterPhoneChats(id)).toHaveLength(1);
  expect(readCharacterPhoneChats(id)[0].name).toBe('朋友');
 });
 it('separate phone clears invalidate only the pending category and cannot resurrect full-suite output',()=>{
  const id='owner';
  const kinds=['chats','contacts','moments','payments'] as const;
  const before=Object.fromEntries(kinds.map(kind=>[kind,readPhoneContentClearRevision(id,kind)]));
  clearSelectedPhoneData(id,['moments','payments']);
  expect(readPhoneContentClearRevision(id,'moments')).toBeGreaterThan(before.moments);
  expect(readPhoneContentClearRevision(id,'payments')).toBeGreaterThan(before.payments);
  expect(readPhoneContentClearRevision(id,'chats')).toBe(before.chats);
  expect(readPhoneContentClearRevision(id,'contacts')).toBe(before.contacts);
  expect(readPhoneContentClearRevision('other','moments')).toBe(0);
  clearSelectedPhoneData(id,['contacts']);
  expect(readPhoneContentClearRevision(id,'contacts')).toBeGreaterThan(before.contacts);
  clearSelectedPhoneData(id,['service']);
  expect(readPhoneContentClearRevision(id,'chats')).toBeGreaterThan(before.chats);
 });
 it('retains Char music persona when resetting optional app install list',()=>{
  localStorage.setItem('sully_character_phone_install_plan_v1:owner','old plan');
  localStorage.setItem('sully_music_state_v1','global music');
  localStorage.setItem('sully_character_phone_social_snapshot_v1:owner:weibo','old posts');
  clearSelectedPhoneData('owner',['install']);
  expect(localStorage.getItem('sully_character_phone_install_plan_v1:owner')).toBeNull();
  expect(localStorage.getItem('sully_music_state_v1')).toBe('global music');
  expect(localStorage.getItem('sully_character_phone_social_snapshot_v1:owner:weibo')).toBe('old posts');
 });
 it('drops only selected phone-origin events from short-term context',()=>{
  const now=Date.now();
  const life=(id:string,kind:'npc-chat'|'browser-search'|'moment-post'|'market-purchase',source:'phone'|'xiaohongshu'='phone')=>
    recordCharacterLifeEvent({id,characterId:'owner',kind,source,occurredAt:now,summary:'saved event'});
  life('phone-inbox','npc-chat');life('phone-search','browser-search');
  life('phone-moment','moment-post');life('external-market','market-purchase','xiaohongshu');
  recordCharacterLifeEvent({id:'other-char',characterId:'other',kind:'npc-chat',source:'phone',occurredAt:now,summary:'keep'});
  const changed:unknown[]=[];
  window.addEventListener('sully:character-life-events-changed',event=>changed.push((event as CustomEvent).detail),{once:true});
  clearSelectedPhoneData('owner',['chats','browser']);
  expect(readCharacterLifeEvents('owner').map(x=>x.id).sort()).toEqual(['external-market','phone-moment']);
  expect(readCharacterLifeEvents('other').map(x=>x.id)).toEqual(['other-char']);
  expect(changed).toEqual([{characterId:'owner',pruned:true}]);
 });
  it('requires explicit groups; never has an automatic all-data erase',()=>{
  expect(clearSelectedPhoneData('owner',[])).toEqual([]);
  expect(PHONE_CLEAR_GROUPS.some(x=>x.id==='all')).toBe(false);
 });
});
