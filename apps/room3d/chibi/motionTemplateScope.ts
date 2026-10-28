/** Owns all per-action temporary objects, not animation clips or resident rigs.
 * One instance per social scene, nothing allocated by the animation frame loop.
 */
export type MotionDisposable={dispose():void};
export function createMotionTemplateScope(){
 let action:string|null=null,revision=0;
 const objects:MotionDisposable[]=[];
 const stop=()=>{
  action=null;revision++;
  let firstError:unknown=null;
  for(let i=objects.length-1;i>=0;i--)try{objects[i].dispose();}catch(e){firstError??=e;}
  objects.length=0;
  if(firstError)throw firstError;
 };
 return {
  begin(id:string){stop();action=id;return revision;},
  own<T extends MotionDisposable|null|undefined>(resource:T):T{
   if(resource){if(action===null){resource.dispose();throw Error('Motion resource created after scene reset');}objects.push(resource);}
   return resource;
  },
  current(token:number){return token===revision&&action!==null;},
  stop,
  /** Dispose every resource and report a release failure without interrupting
   * higher-level session/pose reset. Unlike stop(), this never throws. */
  stopSafely():unknown{
   try{stop();return null;}catch(error){return error;}
  },
  get active(){return action;},
  get ownedCount(){return objects.length;},
 };
}
