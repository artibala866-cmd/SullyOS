/** Whitelisted study-room local records included in full/text backup.
 * This restores the historical pomodoro ledger that the IndexedDB workspace
 * settlements point to; it does NOT migrate it into another task engine.
 */
export const STUDY_ROOM_LOCAL_BACKUP_KEYS=[
  'tasks','records','selectedTask','charId','focusMinutes','breakMinutes',
  'session','notes','lock','coachByChar','coachLastShown','coachEventByChar',
] as const;
export type StudyRoomLocalBackup=Record<string,string|null>;
const prefix='sully_pomodoro_v1_';
export function exportStudyRoomLocal(store:Pick<Storage,'getItem'>=localStorage):StudyRoomLocalBackup{
  const result:StudyRoomLocalBackup={};
  for(const suffix of STUDY_ROOM_LOCAL_BACKUP_KEYS){
    const value=store.getItem(prefix+suffix);
    result[suffix]=value===null?null:value;
  }
  return result;
}
/** Restoring old backups missing this field is a strict no-op. Unrecognized
 * keys and malformed serialized state cannot mutate localStorage.
 */
export function restoreStudyRoomLocal(
  raw:unknown,store:Pick<Storage,'setItem'|'removeItem'>,
):boolean{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  const data=raw as Record<string,unknown>;
  if(Object.keys(data).some(k=>!(STUDY_ROOM_LOCAL_BACKUP_KEYS as readonly string[]).includes(k)))return false;
  for(const key of STUDY_ROOM_LOCAL_BACKUP_KEYS){
    const value=data[key];
    if(value!==undefined&&value!==null){
      if(typeof value!=='string')return false;
      try{JSON.parse(value);}catch{return false;}
    }
  }
  for(const key of STUDY_ROOM_LOCAL_BACKUP_KEYS){
    if(!Object.prototype.hasOwnProperty.call(data,key))continue;
    const value=data[key];
    if(value===null)store.removeItem(prefix+key);
    else if(typeof value==='string'){
      // A timer deadline from another device is not a trustworthy active session.
      if(key==='session')store.removeItem(prefix+key);
      else store.setItem(prefix+key,value);
    }
  }
  return true;
}
