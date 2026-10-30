import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import { writePhoneAutonomyPreferences } from './characterPhoneApiBudget';
import { selectCloudPhoneOpportunity } from './amsgCloudPhoneSelection';
import { isCloudPhoneOpportunityFresh } from './amsgCloudPhone';

const char = (enabled=true) => ({ id:'cloud-phone-selection',activeMsg2Config:{enabled,tasks:[]} }) as unknown as CharacterProfile;
const now=Date.parse('2026-10-30T12:00:00Z');
const at=now-20*60_000;
function store(){
 const m=new Map<string,string>();
 return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},
 removeItem:(k:string)=>{m.delete(k)},clear:()=>m.clear()};
}
beforeEach(()=>{
 vi.stubGlobal('localStorage',store());
 localStorage.setItem('sully_character_phone_npcs_v1:cloud-phone-selection',JSON.stringify([
  {id:'npc1',name:'阿圆',relationship:'同事',identity:'同事',personality:'安静',
   background:'保存的虚构 NPC',source:'generated',createdAt:now-86400_000},
 ]));
 localStorage.setItem('sully_character_phone_wechat_v1:cloud-phone-selection',JSON.stringify([
  {id:'t1',name:'阿圆',contactId:'npc1',time:at,
   messages:[{speaker:{role:'contact',contactId:'npc1'},text:'今天有空吗',createdAt:at}]},
 ]));
});
describe('stage4 cloud snapshot selection',()=>{
 it('only uploads a saved NPC message when both 2.0 and same-round opt-in are explicit',()=>{
  expect(selectCloudPhoneOpportunity(char(),now)).toBeNull();
  writePhoneAutonomyPreferences(char().id,{chatPiggybackEnabled:true});
  const selection=selectCloudPhoneOpportunity(char(),now);
  expect(selection?.contactId).toBe('npc1');
  expect(selection?.replyToText).toBe('今天有空吗');
  expect(selection?.contactCreatedAt).toBe(now-86400_000);
  expect(selection?.contactsClearRevision).toBe(0);
  expect(selection && isCloudPhoneOpportunityFresh(selection,now)).toBe(true);
  expect(selectCloudPhoneOpportunity(char(false),now)).toBeNull();
 });
 it('works with separately paid phone AI and foreground master disabled',()=>{
  localStorage.setItem('sully_phone_autonomy_disabled_v1:cloud-phone-selection','1');
  writePhoneAutonomyPreferences(char().id,{chatPiggybackEnabled:true,backgroundApiEnabled:false});
  expect(selectCloudPhoneOpportunity(char(),now)?.contactId).toBe('npc1');
 });
 it('a pending linked real Char must not mask a later eligible NPC reply',()=>{
  writePhoneAutonomyPreferences(char().id,{chatPiggybackEnabled:true});
  const npcs=JSON.parse(localStorage.getItem('sully_character_phone_npcs_v1:cloud-phone-selection')||'[]');
  npcs.push({id:'real',name:'另一个真实 Char',relationship:'同事',identity:'Char',
    personality:'真实角色',background:'角色',source:'character',linkedCharacterId:'linked-char',createdAt:now-86400_000});
  localStorage.setItem('sully_character_phone_npcs_v1:cloud-phone-selection',JSON.stringify(npcs));
  const chats=JSON.parse(localStorage.getItem('sully_character_phone_wechat_v1:cloud-phone-selection')||'[]');
  chats.unshift({id:'real-thread',contactId:'real',name:'另一个真实 Char',
    time:now-30*60_000,messages:[{speaker:{role:'contact',contactId:'real'},
      text:'先前的一条真实角色待回消息',createdAt:now-30*60_000}]});
  localStorage.setItem('sully_character_phone_wechat_v1:cloud-phone-selection',JSON.stringify(chats));
  expect(selectCloudPhoneOpportunity(char(),now)?.contactId).toBe('npc1');
 });
 it('never impersonates another real Char in a linked phone contact',()=>{
  writePhoneAutonomyPreferences(char().id,{chatPiggybackEnabled:true});
  const list=JSON.parse(localStorage.getItem('sully_character_phone_npcs_v1:cloud-phone-selection')||'[]');
  list[0].linkedCharacterId='real-char';
  localStorage.setItem('sully_character_phone_npcs_v1:cloud-phone-selection',JSON.stringify(list));
  expect(selectCloudPhoneOpportunity(char(),now)).toBeNull();
 });
 it('rejects a local User message masquerading as the latest NPC reply',()=>{
  writePhoneAutonomyPreferences(char().id,{chatPiggybackEnabled:true});
  const list=JSON.parse(localStorage.getItem('sully_character_phone_wechat_v1:cloud-phone-selection')||'[]');
  list[0].messages[0].speaker={role:'user'};
  localStorage.setItem('sully_character_phone_wechat_v1:cloud-phone-selection',JSON.stringify(list));
  expect(selectCloudPhoneOpportunity(char(),now)).toBeNull();
 });
});
