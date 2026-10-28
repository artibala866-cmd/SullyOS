// @vitest-environment jsdom
import {beforeEach,describe,it,expect} from 'vitest';
import {readCharacterPhoneChats,deleteCharacterPhoneChat} from './characterPhoneChats';
import {recordCharacterLifeEvent,readCharacterLifeEvents,attachCharacterLifeGlimpse} from './characterLifeEvents';
import {selectConfirmedLifeGlimpses} from './characterLifeGlimpses';
import {saveNpcProfiles,readNpcProfiles} from './characterPhoneNpcs';
import {readPhoneContentClearRevision} from './characterPhoneContentClearRevision';
import {clearSelectedPhoneData} from './characterPhoneClear';

beforeEach(()=>localStorage.clear());
const now=Date.now();
const setup=()=>{
 const chats=[
  {id:'thread-a',contactId:'npc-a',kind:'npc',name:'小乔',preview:'明天见',time:now,
   messages:[{speaker:{role:'owner'},text:'明天一起去玩好吗？',createdAt:now}]},
  {id:'thread-b',contactId:'npc-b',kind:'npc',name:'阿林',preview:'工作中',time:now,
   messages:[{speaker:{role:'contact',contactId:'npc-b'},text:'我在工作',createdAt:now}]},
 ];
 localStorage.setItem('sully_character_phone_wechat_v1:char',JSON.stringify(chats));
 saveNpcProfiles('char',[
  {id:'npc-a',name:'小乔',identity:'朋友',personality:'幽默',relationship:'朋友',background:'',source:'generated',createdAt:now,
   relationshipNotes:'[2026微信提及] Char：明天一起去玩好吗？\n角色喜欢看星星'},
  {id:'npc-b',name:'阿林',identity:'同事',personality:'直接',relationship:'同事',background:'',source:'generated',createdAt:now,
   relationshipNotes:'[2026微信提及] NPC：我在工作'},
 ] as any);
 return chats;
};
describe('deleted phone conversations cannot leak into life glimpses',()=>{
 it('retracts a deleted thread across old and new phone event shapes; unrelated phone and XHS facts survive',()=>{
  setup();
  const ev=(id:string,kind:any,source:any,contactId?:string,phoneThreadId?:string)=>
   recordCharacterLifeEvent({id,characterId:'char',kind,source,contactId,phoneThreadId,
     occurredAt:now,summary:'确认已存储的事实'});
  ev('npc-chat:thread-a:11','npc-chat','phone','npc-a');
  ev('npc-chat:inbox:thread-a:12','npc-chat','phone','npc-a');
  ev('npc-chat:auto:thread-a:13','npc-chat','phone','npc-a');
  ev('new','npc-chat','phone','npc-a','thread-a');
  ev('keep','npc-chat','phone','npc-b','thread-b');
  ev('external','browser-search','xiaohongshu');
  expect(readCharacterLifeEvents('char')).toHaveLength(6);
  const rev=readPhoneContentClearRevision('char','chats');
  expect(deleteCharacterPhoneChat('char','thread-a')).toBe(true);
  expect(readPhoneContentClearRevision('char','chats')).toBe(rev+1);
  expect(readCharacterPhoneChats('char').map(r=>r.id)).toEqual(['thread-b']);
  expect(readCharacterLifeEvents('char').map(e=>e.id).sort()).toEqual(['external','keep']);
  expect(selectConfirmedLifeGlimpses(readCharacterLifeEvents('char'),'char').map(e=>e.id).sort()).toEqual(['external','keep']);
  expect(readNpcProfiles('char').find(p=>p.id==='npc-a')?.relationshipNotes).toBe('角色喜欢看星星');
  expect(readNpcProfiles('char').find(p=>p.id==='npc-b')?.relationshipNotes).toContain('我在工作');
  expect(deleteCharacterPhoneChat('char','thread-a')).toBe(false);
 });
 it('an already-running life AI cannot attach to the deleted event, and another character is untouched',()=>{
  setup();
  const item={id:'npc-chat:thread-a:1',characterId:'char',source:'phone' as const,
    kind:'npc-chat' as const,occurredAt:now,summary:'已删除内容'};
  recordCharacterLifeEvent(item);
  recordCharacterLifeEvent({...item,characterId:'else'});
  deleteCharacterPhoneChat('char','thread-a');
  expect(attachCharacterLifeGlimpse(item,'删除以后不能重新写入')).toBe(false);
  expect(readCharacterLifeEvents('else')).toHaveLength(1);
 });
 it('bulk clear also strips relationship snippets, not non-WeChat notes or private chats',()=>{
  setup();
  clearSelectedPhoneData('char',['chats']);
  expect(readCharacterPhoneChats('char')).toEqual([]);
  expect(readNpcProfiles('char').find(p=>p.id==='npc-a')?.relationshipNotes).toBe('角色喜欢看星星');
  expect(readNpcProfiles('char')).toHaveLength(2);
 });
});
