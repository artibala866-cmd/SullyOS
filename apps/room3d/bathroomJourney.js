import {MathUtils as M} from 'three';
import {gamingPoint,clearance} from './gaming.js';
const mix=(a,b,t)=>a.map((v,i)=>M.lerp(v,b[i],t));
const turn=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
const pulse=(p,a,b,c,d)=>M.smootherstep(p,a,b)*(1-M.smootherstep(p,c,d));

export function bathroomEntryCandidates(item,kind){
 const x=kind==='bath-soak'?.65:0;
 return [1.35,1.6,1.9,2.2].flatMap(z=>(kind==='bath-soak'?[0,-.25,.25,-.5,-.8,-1.1]:[0,-.25,.25,-.5,.5]).map(dx=>gamingPoint(item,[x+dx,.03,z])));
}
export function createBathroomJourney(activity,front,startRotation){
 const tub=activity.kind==='bath-soak',seated=activity.posture==='seated';
 return {front:[...front],startRotation,edge:activity.edge,position:[...activity.position],rotation:activity.rotation,
  edgeRotation:activity.edgeRotation??activity.rotation,tub,seated,enter:tub?3.6:seated?1.4:1.2,hold:activity.duration||12};
}

/** Keep the authored rim contact positions fixed in the room while the actor turns.
 * The IK player takes actor-local goals, not goals that follow the moving root.
 * No contact point is inferred from the furniture's bounding box. */
/** Refuse a skeletal rim crossing when neither authored palm target is
 * plausibly reachable from its actual entrance. Never guess a bbox grip. */
export function bathroomRimReachable(activity,front,reach){
 if(activity?.kind!=='bath-soak')return true;
 if(!Array.isArray(activity.bathHandWorld)||!activity.bathHandWorld.length)return false;
 // A legacy non-skeletal character has no actual joint reach model.
 if(!reach||!Number.isFinite(reach.armReach)||!Number.isFinite(reach.shoulderHeight))return true;
 const shoulderY=front[1]+reach.shoulderHeight;
 return activity.bathHandWorld.some(([x,y,z])=>
  Math.hypot(x-front[0],y-shoulderY,z-front[2])<=reach.armReach*1.12+.60);
}

export function bathroomHandTargets(activity,frame){
 if(!Array.isArray(activity.bathHandWorld)||!frame)return activity.bathHands;
 const c=Math.cos(frame.rotation),s=Math.sin(frame.rotation);
 return activity.bathHandWorld.map(([x,y,z])=>{
  const dx=x-frame.position[0],dz=z-frame.position[2];
  return [c*dx-s*dz,y-frame.position[1],s*dx+c*dz];
 });
}

/** One reversible clock for yaw, stance, individual leg clearance and contact.
 * A tub's high rim is a HAND contact, never a target for the actor's feet/root.
 * Returning through the same phases also handles cancellation partway through a step. */
export function bathroomJourneyFrame(j,time){
 const duration=j.enter*2+j.hold,t=M.clamp(time,0,duration),
  cancelled=Number.isFinite(j.cancelElapsed)&&t>=j.cancelElapsed;
 const entryProgress=j.cancelElapsed<j.enter?j.cancelElapsed
  :j.cancelElapsed<j.enter+j.hold?j.enter:Math.max(0,duration-j.cancelElapsed);
 const progress=cancelled?Math.max(0,entryProgress-(t-j.cancelElapsed)):undefined;
 const phase=cancelled?'exit':t<j.enter?'enter':t<j.enter+j.hold?'work':'exit';
 const p=cancelled?progress:phase==='enter'?t:phase==='work'?j.enter:duration-t;
 let position,rotation,seatWeight=0,legLift=0,support=0,approachStep=0,leadStep=0,trailStep=0,lean=0;
 if(j.tub){
  // Turn on the planted feet, reach the rim, lift one leg, transfer weight,
  // then lift the trailing leg. Lower into the authored seat AFTER clearing.
  // In particular, never lerp the root to j.edge[1] (the ~1.17m rim).
  const facing=M.smootherstep(p,0,.48);
  support=M.smootherstep(p,.36,1.02)*(1-M.smootherstep(p,3.05,3.6));
  approachStep=pulse(p,.32,.51,.76,1.03);
  leadStep=pulse(p,1.03,1.40,1.73,2.12);
  trailStep=pulse(p,1.76,2.11,2.51,2.94);
  lean=M.smootherstep(p,.58,1.12)*(1-M.smootherstep(p,2.65,3.55));
  // Walk the last short, grounded step to reach the REAL near rim before
  // the first crossing leg lifts. Do not drag the standing root vertically.
  const advance=.27*M.smootherstep(p,.32,1.02)+.73*M.smootherstep(p,1.33,2.96);
  const lower=M.smootherstep(p,2.50,3.6);
  position=mix(j.front,j.position,advance);
  position[1]=M.lerp(j.front[1],j.position[1],lower);
  rotation=turn(turn(j.startRotation,j.edgeRotation,facing),j.rotation,M.smootherstep(p,2.65,3.55));
  seatWeight=lower;legLift=M.smootherstep(p,2.38,3.25);
 }else{
  const f=M.smootherstep(p,0,j.enter);
  position=mix(j.front,j.position,f);rotation=turn(j.startRotation,j.rotation,f);seatWeight=j.seated?f:0;
 }
 return {position,rotation,seatWeight,legLift,support,approachStep,leadStep,trailStep,lean,phase,time:phase==='work'?t-j.enter:p,
  done:cancelled?t-j.cancelElapsed>=entryProgress:t>=duration};
}

/** Validate the swept room envelope at planning time, not on every render.
 * The interacting fixture is intentionally excluded (the resident must
 * enter it); walls and every unrelated placed object remain solid.
 * This complements, but does not replace, visual GLB rim penetration QA. */
export function bathroomJourneyObstacleIssue(room,catalog,activity,journey,headWidth=1.5){
 if(!room||!journey)return '没有有效的卫浴入口';
 const itemId=activity?.itemId;
 const exclusions=[itemId,...(room.items||[]).filter(i=>i.supportId===itemId||
  (room.items||[]).some(parent=>parent.id===i.supportId&&parent.supportId===itemId)).map(i=>i.id)];
 for(let i=0;i<=30;i++){
  const f=bathroomJourneyFrame(journey,journey.enter*i/30);
  const issue=clearance(room,catalog,{position:f.position,rotation:f.rotation,kind:activity.kind},
   exclusions,headWidth);
  if(issue)return '卫浴进入或退出路线被挡住了：'+issue;
 }
 return '';
}
