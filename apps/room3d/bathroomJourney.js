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
  edgeRotation:activity.edgeRotation??activity.rotation,tub,seated,enter:tub?4.6:seated?1.4:1.2,hold:activity.duration||12};
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
 let position,rotation,seatWeight=0,legLift=0,support=0,approachStep=0,approachTrailStep=0,leadStep=0,trailStep=0,leadTuck=0,trailTuck=0,lean=0,crouch=0,supportFoot=null;
 if(j.tub){
  // Turn on the planted feet, reach the rim, lift one leg, transfer weight,
  // then lift the trailing leg. Lower into the authored seat AFTER clearing.
  // In particular, never lerp the root to j.edge[1] (the ~1.17m rim).
  const facing=M.smootherstep(p,0,.48);
  support=M.smootherstep(p,.36,1.02)*(1-M.smootherstep(p,4.0,4.6));
  // Two short physical footfalls, never a 36cm translation on one planted leg.
  // Left swings while right bears weight, then right swings after left lands.
  approachStep=pulse(p,.28,.47,.59,.76);
  approachTrailStep=pulse(p,.78,.94,1.02,1.20);
  supportFoot=p>=.27&&p<.77?'R':p>=.77&&p<1.24?'L':null;
  // Tuck the knee vertically before swinging the foot across the tall rim.
  // The two contacts are separate: lift first, then transfer across.
  leadTuck=pulse(p,1.35,1.67,3.46,3.90);
  trailTuck=pulse(p,2.82,3.03,3.48,3.90);
  leadStep=pulse(p,1.84,2.12,3.44,3.82);
  trailStep=pulse(p,2.97,3.19,3.48,3.87);
  // Hands may reach early; knee flexion and pelvis lowering must wait for
  // BOTH approach feet to land, otherwise the anchored stance toe jumps.
  crouch=M.smootherstep(p,1.24,1.76)*(1-M.smootherstep(p,3.72,4.52));
  lean=M.smootherstep(p,1.16,1.78)*(1-M.smootherstep(p,3.75,4.55));
  // Walk the last short, grounded step to reach the REAL near rim before
  // the first crossing leg lifts. Do not drag the standing root vertically.
  // Shift weight onto the new left landing before the right foot follows.
  // The previous .12/.15 split carried the swing foot back to its start.
  // Cross the rim in two weight transfers while each corresponding knee is
  // raised; the former single late travel carried grounded feet through GLB.
  const advance=.20*M.smootherstep(p,.30,.74)+.07*M.smootherstep(p,.79,1.19)
   +.24*M.smootherstep(p,3.07,3.40)+.49*M.smootherstep(p,3.40,4.10);
  const lower=M.smootherstep(p,3.52,4.6);
  position=mix(j.front,j.position,advance);
  // A high-sided GLB tub requires a supported transfer of the pelvis:
  // the anchored hands bear weight while both feet clear the real high rim.
  // The hoist is gradual and never reaches the rim's root-height, unlike
  // the former unsupported upward jump.
  const bracedHoist=.26*M.smootherstep(p,1.48,1.96)
   *(1-M.smootherstep(p,3.36,4.20));
  position[1]=M.lerp(j.front[1],j.position[1],lower)+bracedHoist;
  const turnWeight=M.smootherstep(p,3.56,4.53);
  rotation=turn(turn(j.startRotation,j.edgeRotation,facing),j.rotation,turnWeight);
  // Pivot smoothly towards the interior while the lifted legs settle, then
  // return to the exact authored seat center. Never rotate a planted toe
  // across the near rim or teleport the character.
  const dx=j.position[0]-j.front[0],dz=j.position[2]-j.front[2],length=Math.hypot(dx,dz)||1;
  const interiorScoot=.40*Math.sin(Math.PI*turnWeight);
  position[0]+=dx/length*interiorScoot;
  position[2]+=dz/length*interiorScoot;
  seatWeight=lower;legLift=M.smootherstep(p,3.32,4.24);
 }else{
  const f=M.smootherstep(p,0,j.enter);
  position=mix(j.front,j.position,f);rotation=turn(j.startRotation,j.rotation,f);seatWeight=j.seated?f:0;
 }
 return {position,rotation,seatWeight,legLift,support,approachStep,approachTrailStep,supportFoot,leadStep,trailStep,leadTuck,trailTuck,lean,crouch,phase,time:phase==='work'?t-j.enter:p,
  done:cancelled?t-j.cancelElapsed+1e-8>=entryProgress:t>=duration};
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
