// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {DB,openDB} from './db';
import {clearHomeHistory} from './homeHistoryCleanup';
import {mirrorPrivateChat} from './characterPhonePrivateSync';
import type {CharacterProfile} from '../types';
import type {HomeRecord} from '../apps/room3d/types';

let number=0;
const entry=(id:string,kind:HomeRecord['kind']='message'):HomeRecord=>({
 id,at:Date.now(),kind,source:'user',actor:'user',text:'测试记录 '+id,
 roomId:'living',roomName:'客厅',
});
const owner=(records:HomeRecord[])=>({
 id:'home-clear-'+(++number),name:'测试角色',
 home3D:{version:1,activeRoomId:'living',rooms:[],records,
  activityLog:[{at:Date.now(),roomId:'living',roomName:'客厅',label:'曾经的活动',kind:'activity-start'}],
  autonomy:true},
} as CharacterProfile);
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});

it('removes messages, actions and legacy activity from home, private prompt and phone mirror without touching ordinary chats',async()=>{
 const char=owner([entry('hello'),entry('gesture','action'),entry('presence','presence')]);
 const other=owner([entry('other')]);
 await DB.saveCharacter(char);await DB.saveCharacter(other);
 await DB.saveMessage({charId:char.id,role:'user',type:'text',content:'真正的 User/Char 私聊',timestamp:Date.now()});
 await DB.saveMessage({charId:char.id,role:'user',type:'text',content:'群聊记录',groupId:'group-1' as any,timestamp:Date.now()});
 const before=await DB.getMessagesByCharId(char.id,true);
 expect(before.some(m=>m.metadata?.source==='home')).toBe(true);
 expect(mirrorPrivateChat(char.id,before).messages.some(m=>m.text.includes('测试记录'))).toBe(true);

 const result=await clearHomeHistory(char.id);
 expect(result.records).toBe(4);
 expect(result.messages).toBeGreaterThanOrEqual(1);
 const home=(await DB.getCharacter(char.id))!.home3D!;
 expect(home.records).toEqual([]);
 expect(home.activityLog).toEqual([]);
 expect(home.autonomy).toBe(true);
 const after=await DB.getMessagesByCharId(char.id,true);
 expect(after.filter(m=>m.metadata?.source==='home')).toHaveLength(0);
 expect(after.some(m=>m.content==='真正的 User/Char 私聊')).toBe(true);
 expect(mirrorPrivateChat(char.id,after).messages.map(m=>m.text)).toEqual(['真正的 User/Char 私聊']);
 expect((await DB.getMessagesByCharId(other.id,true)).some(m=>m.metadata?.source==='home')).toBe(true);
 expect((await DB.getMessagesByCharId(char.id,true)).every(m=>m.metadata?.source!=='home')).toBe(true);
 expect(await clearHomeHistory(char.id)).toEqual({records:0,messages:0});
});
it('keeps the journal and its private-chat projection together if deletion transaction fails',async()=>{
 const char=owner([entry('should-stay')]);await DB.saveCharacter(char);
 const old=IDBObjectStore.prototype.delete;
 const restore=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,...args:any[]){
  if(this.name==='messages'){this.transaction.abort();return {} as IDBRequest;}
  return old.apply(this,args as any);
 });
 await expect(clearHomeHistory(char.id)).rejects.toThrow();
 restore.mockRestore();
 expect((await DB.getCharacter(char.id))?.home3D?.records?.map(x=>x.id)).toEqual(['should-stay']);
 expect((await DB.getMessagesByCharId(char.id,true)).some(m=>m.metadata?.source==='home')).toBe(true);
});
