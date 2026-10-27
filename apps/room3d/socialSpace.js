/** Standing clearance for uninvolved residents during a social action.
 * Reuses core-body navigation footprint; checked during planning and playback.
 */
export const SOCIAL_OBSERVER_CLEARANCE=.60;
export function clearSocialObservers(paths,observers,minimum=SOCIAL_OBSERVER_CLEARANCE){
 return paths.every(path=>path.every(p=>observers.every(q=>Math.hypot(q.x-p.x,q.z-p.z)>=minimum-1e-6)));
}

/** Reuse the room collision map until layout/character clearance changes.
 * getMap must include furniture as well as walls. Observer positions stay live.
 * Sweep between samples so low frame rates cannot step over a thin obstacle.
 */
export function createSocialSpaceCheck({getMap,getRevision,getObservers,offset={x:0,z:0}}){
 let revision,map;
 return paths=>{
  const next=getRevision();
  if(!map||next!==revision){map=getMap();revision=next;}
  const observers=getObservers();
  const free=p=>map.free(p.x+offset.x,p.z+offset.z)&&clearSocialObservers([[p]],observers);
  return paths.every(path=>path.every((p,i)=>{
   if(!free(p))return false;
   if(!i)return true;
   const from=path[i-1],steps=Math.ceil(Math.hypot(p.x-from.x,p.z-from.z)/.06);
   for(let j=1;j<steps;j++)if(!free({x:from.x+(p.x-from.x)*j/steps,z:from.z+(p.z-from.z)*j/steps}))return false;
   return true;
  }));
 };
}
