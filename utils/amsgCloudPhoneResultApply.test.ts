import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./db',()=>({DB:{getAllCharacters:vi.fn()}}));
import { DB } from './db';
import { applyCloudPhoneResult } from './amsgCloudPhoneResultApply';
import { CLOUD_PHONE_RESULT_KIND } from './amsgCloudPhone';
import { readCharacterPhoneChats } from './characterPhoneChats';
import { readCharacterLifeEvents } from './characterLifeEvents';
import { advancePhoneContentClearRevision } from './characterPhoneContentClearRevision';
import { readPhoneAutonomyRevision, writePhoneAutonomyPreferences } from './characterPhoneApiBudget';
function storage(){
 const m=new Map<string,string>();return {
  getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,String(v));},
  removeItem:(k:string)=>{m.delete(k);},clear:()=>m.clear(),
  key:(i:number)=>Array.from(m.keys())[i]??null,get length(){return m.size;}
 };
}
const id='stage4-role-'+Math.random().toString(36).slice(2);
const contact='stage4-npc';
const thread='stage4-thread';
let at=0;let row:Record<string,unknown>;
beforeEach(()=>{
 vi.stubGlobal('localStorage',storage());
 vi.mocked(DB.getAllCharacters).mockReset().mockResolvedValue([
  {id,activeMsg2Config:{enabled:true,tasks:[]}} as any,
 ]);
 const now=Date.now(); at=now-25*60000;
 localStorage.setItem('sully_character_phone_npcs_v1:'+id,JSON.stringify([
  {id:contact,name:'小圆',identity:'同事',personality:'干脆',relationship:'朋友',
   background:'真实保存的虚构联系人',source:'generated',createdAt:now-86400000}
 ]));
 localStorage.setItem('sully_character_phone_wechat_v1:'+id,JSON.stringify([
  {id:thread,contactId:contact,name:'小圆',preview:'忙吗',time:at,
   messages:[{speaker:{role:'contact',contactId:contact},text:'忙吗',createdAt:at}]}
 ]));
 writePhoneAutonomyPreferences(id,{chatPiggybackEnabled:true,backgroundApiEnabled:true});
 row={resultKind:CLOUD_PHONE_RESULT_KIND,id:'cloud-npc:abcd',charId:id,
  contactId:contact,threadId:thread,sourceKey:'reply:'+thread+':'+at+':1',
  replyToAt:at,replyToCount:1,replyToText:'忙吗',
  revision:readPhoneAutonomyRevision(id),clearRevision:0,occurredAt:now,
  messages:['刚忙完，怎么啦？']};
});
describe('stage4: outbox replay and user sovereignty',()=>{
 it('applies one cloud-confirmed owner reply and records one actual life event',async()=>{
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(2);
  expect(readCharacterPhoneChats(id)[0].messages[1].speaker.role).toBe('owner');
  expect(readCharacterLifeEvents(id).filter(e=>e.kind==='npc-chat')).toHaveLength(1);
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(2);
  expect(readCharacterLifeEvents(id).filter(e=>e.kind==='npc-chat')).toHaveLength(1);
 });
 it('rejects a delayed cloud reply when user disabled opt-in',async()=>{
  writePhoneAutonomyPreferences(id,{chatPiggybackEnabled:false});
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(1);
 });
 it('still applies explicit same-round consent with independent paid phone AI and phone master switched off',async()=>{
  writePhoneAutonomyPreferences(id,{backgroundApiEnabled:false,chatPiggybackEnabled:true});
  localStorage.setItem('sully_phone_autonomy_disabled_v1:'+id,'1');
  row.revision=readPhoneAutonomyRevision(id);
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(2);
 });
 it('never resurrects a chat after the user cleared the inbox',async()=>{
  advancePhoneContentClearRevision(id,'chats');
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(1);
 });
 it('never overwrites a local reply that arrived after snapshot',async()=>{
  const list=readCharacterPhoneChats(id);
  list[0].messages.push({speaker:{role:'owner'},text:'我已经回复了',createdAt:Date.now()});
  localStorage.setItem('sully_character_phone_wechat_v1:'+id,JSON.stringify(list));
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(2);
  expect(readCharacterPhoneChats(id)[0].messages[1].text).toBe('我已经回复了');
 });
 it('does not impersonate another real Character as an NPC',async()=>{
  const list=JSON.parse(localStorage.getItem('sully_character_phone_npcs_v1:'+id)||'[]');
  list[0].linkedCharacterId='real-char';
  localStorage.setItem('sully_character_phone_npcs_v1:'+id,JSON.stringify(list));
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(1);
 });
 it('rejects if the Char is deleted or 2.0 is disabled',async()=>{
  vi.mocked(DB.getAllCharacters).mockResolvedValueOnce([]);
  expect(await applyCloudPhoneResult(row)).toBe(true);
  vi.mocked(DB.getAllCharacters).mockResolvedValueOnce([{id,activeMsg2Config:{enabled:false}}] as any);
  expect(await applyCloudPhoneResult(row)).toBe(true);
  expect(readCharacterPhoneChats(id)[0].messages).toHaveLength(1);
 });
});
