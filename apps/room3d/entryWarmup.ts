import type {HomeEditor} from './editor.js';

/**
 * Entry-time GPU shader warmup. A slow mobile driver must not hold the house
 * behind an indefinite WebGL compilation promise. Compilation continues in
 * the renderer if the time budget expires; no model or clip is discarded.
 */
export async function warmHomeResidentForEntry(
 editor:Pick<HomeEditor,'warmResidentShaders'>,
 maxWaitMs=1800,
):Promise<void>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([
   Promise.resolve().then(()=>editor.warmResidentShaders?.()).catch(()=>{}),
   new Promise<void>(resolve=>{timer=setTimeout(resolve,maxWaitMs);}),
  ]);
 }finally{if(timer!==undefined)clearTimeout(timer);}
}
