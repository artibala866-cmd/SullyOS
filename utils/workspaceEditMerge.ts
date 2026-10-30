/**
 * Persist one local UI edit against the latest workspace, never a whole stale
 * React render snapshot. Reminder UUIDs and ChatApp consent live in separate
 * fields and must never be overwritten by form edits.
 */
import type {WorkspaceData} from './sullyWorkspace';

type Row = {id:string};
type WorkspaceRows = 'commissions'|'classes'|'homework'|'notes'|'planSlots'|'availability';
const rowKeys:WorkspaceRows[]=['commissions','classes','homework','notes','planSlots','availability'];
const same=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);

function mergeRows<T extends Row>(before:T[],after:T[],current:T[],label:string):T[] {
  const old=new Map(before.map(x=>[x.id,x]));
  const now=new Map(current.map(x=>[x.id,x]));
  const next=new Map(after.map(x=>[x.id,x]));
  if(next.size!==after.length)throw new Error(label+'出现重复记录 ID');
  const result:T[]=[];
  for(const existing of current){
    const previous=old.get(existing.id);
    const edited=next.get(existing.id);
    if(!previous) {result.push(existing);continue;}
    if(!edited){
      if(!same(previous,existing))throw new Error(label+'已经在别处修改，不能删除旧快照');
      continue;
    }
    const beforeFields=previous as unknown as Record<string,unknown>;
    const editedFields=edited as unknown as Record<string,unknown>;
    const currentFields=existing as unknown as Record<string,unknown>;
    const patched:Record<string,unknown>={...existing};
    for(const key of new Set([...Object.keys(beforeFields),...Object.keys(editedFields)])){
      if(key==='id'||same(beforeFields[key],editedFields[key]))continue;
      if(!same(currentFields[key],beforeFields[key]) && !same(currentFields[key],editedFields[key]))
        throw new Error(label+'的「'+key+'」已被其他操作修改，请刷新后重试');
      if(Object.prototype.hasOwnProperty.call(editedFields,key))patched[key]=editedFields[key];
      else delete patched[key];
    }
    result.push(patched as unknown as T);
  }
  for(const added of after){
    if(old.has(added.id)) {
      if(!now.has(added.id))throw new Error(label+'已从其它位置删除，请刷新后重试');
      continue;
    }
    if(now.has(added.id))throw new Error(label+'的新记录 ID 冲突');
    result.push(added);
  }
  return result;
}

export function mergeWorkspaceLocalEdit(
  before:WorkspaceData,after:WorkspaceData,current:WorkspaceData,
):WorkspaceData {
  const result:WorkspaceData={...current};
  for(const field of rowKeys){
    // The common Row base is enough for key-aware patching; preserve the
    // original typed collection at runtime and at the external boundary.
    (result as unknown as Record<string,unknown>)[field]=mergeRows(
      (before[field]||[]) as Row[],(after[field]||[]) as Row[],(current[field]||[]) as Row[],field,
    );
  }
  if(!same(before.dailyAvailableMinutes,after.dailyAvailableMinutes)){
    if(!same(current.dailyAvailableMinutes,before.dailyAvailableMinutes)
      && !same(current.dailyAvailableMinutes,after.dailyAvailableMinutes))
      throw new Error('每日可用时间已在其它位置修改');
    result.dailyAvailableMinutes=after.dailyAvailableMinutes;
  }
  return result;
}
