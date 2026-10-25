/** One transaction clears this character's 3D-home journal AND every home
 * projection in real private chat (also read by Check Phone / User-Char).
 * Do not touch ordinary private messages, groups, NPC phone chats or other
 * character histories. A failed transaction keeps both stores unchanged.
 */
import {openDB} from './db';
import type {CharacterProfile,Message} from '../types';
import {announceSecretNotesChanged,deleteLinkedSecretNotes,HOME_HISTORY_COMMITTED} from './secretNote';

export type HomeHistoryClearResult={records:number;messages:number};

export async function clearHomeHistory(charId:string):Promise<HomeHistoryClearResult>{
 if(!charId)throw Error('请选择要清空的家园角色');
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(['characters','messages'],'readwrite');
  const characters=tx.objectStore('characters');
  const messages=tx.objectStore('messages');
  const count:HomeHistoryClearResult={records:0,messages:0};
  const get=characters.get(charId);
  get.onsuccess=()=>{
   const character=get.result as CharacterProfile|undefined;
   if(!character){tx.abort();return;}
   const old=character.home3D;
   if(old){
    count.records=(old.records?.length??0)+(old.activityLog?.length??0);
    // Preserve the room/furniture/pet state. Empty records even if it is the
    // first clear of a legacy activityLog-only home.
    characters.put({...character,home3D:{...old,records:[],activityLog:[]}});
   }
  };
  const scan=messages.index('charId').openCursor(IDBKeyRange.only(charId));
  scan.onsuccess=()=>{
   const cursor=scan.result;
   if(!cursor)return;
   const row=cursor.value as Message;
   if(!row.groupId&&row.metadata?.source==='home'){
    deleteLinkedSecretNotes(messages,row);
    cursor.delete();
    count.messages++;
   }
   cursor.continue();
  };
  tx.oncomplete=()=>{
   announceSecretNotesChanged(charId);
   if(typeof window!=='undefined'){
    window.dispatchEvent(new CustomEvent(HOME_HISTORY_COMMITTED,{detail:{charId,cleared:true}}));
   }
   resolve(count);
  };
  tx.onerror=()=>reject(tx.error||new Error('清空家园记录失败'));
  tx.onabort=()=>reject(tx.error||new Error('清空家园记录已取消'));
 });
}
