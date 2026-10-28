/**
 * Exclusive same-origin scheduling lock for AMSG2's autonomous cloud tasks.
 *
 * An in-memory Set cannot prevent two open tabs from both inspecting the
 * same empty remote list and each creating a paid recurring task.
 * navigator.locks coordinates tabs and windows in browsers that support it.
 * On older WebViews we retain the existing process-local protection, but
 * do NOT claim atomic cross-device idempotency (that needs D1 uniqueness).
 */
const localLocks = new Set<string>();
export async function withAutonomyWakeLock<T>(charId:string,run:()=>Promise<T>):Promise<T|undefined>{
  if (!charId) return undefined;
  const name='sully-amsg2-autowake:'+charId;
  const locks=typeof navigator!=='undefined'
    ? (navigator as Navigator&{locks?:{request:<U>(name:string,options:{mode:'exclusive'},cb:()=>Promise<U>)=>Promise<U>}}).locks
    : undefined;
  if(locks?.request) return locks.request(name,{mode:'exclusive'},run);
  // No fake cross-tab lock. This is only a safe local fallback; cloud
  // reconciliation inside run will still catch already-visible remote tasks.
  if(localLocks.has(name))return undefined;
  localLocks.add(name);
  try{return await run();}finally{localLocks.delete(name);}
}
