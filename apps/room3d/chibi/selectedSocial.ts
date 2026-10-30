import {planPassionKiss,posePassionKiss,passionKissPhase,type PassionKissPlan} from './passionKissMotion';
import {planSneakKiss,planSneakKissApproach,poseSneakKiss,sneakKissPhase,sneakKissExpression,type SneakKissPlan} from './sneakKissMotion';
import {actionExpression} from './actionExpression';
import {isSeasonalSocial,poseSeasonalSocial,seasonalExpression} from './seasonalSocial';
import {loadHalloweenProps,createHalloweenProp} from './halloweenProps';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {selectedMotions,loadSelectedMotion,sampleSelected,type SelectedClip,type MotionFrame} from './selectedMotions';
import {contactSolver,sharedPalmTarget} from './socialContact';
import {furniturePalm} from './furnitureMotion';
import {createSocialProp} from './socialProps';
import {isIntimacy,isPrincessCarry,poseIntimacy} from './intimacyMotion';
import {carryCaptureWeight,prepareCarryFrame} from './princessCarryCapture';
import {splitMotionHeading} from './motionHeading';
import {motionTemplateFor,motionTemplateContact,motionTemplateConstraintPlans} from './motionTemplates';
import {createMotionTemplateScope} from './motionTemplateScope';
import {applyTemplateFaceContact} from './templateFaceContact';
import {applyHeadPatMotion,applyHeadPatExpressions} from './headPatMotion';
import {planRearHugApproach} from './rearHugMotion';
import {pleadStandingPoint} from './handHoldPleadMotion';
import {applyStandingHeightAdaptation} from './standingHeightAdaptation';
import {applyPairedHandContact} from './pairedHandContact';
import {createMotionConstraintPipeline} from './motionConstraintPipeline';
export {motionCategories} from './selectedMotions';
/** Horizontal collision proxies based on the posed world shoulder span,
 * rather than a fixed distance for every chibi scale. These are conservative
 * broadphase radii, not mesh/costume collision or a replacement for close
 * contact and full-body IK. */
export function socialBodyCollisionRadii(shoulderSpan:number,headSize=1){
 const span=Number.isFinite(shoulderSpan)&&shoulderSpan>0?shoulderSpan:.76;
 const size=Number.isFinite(headSize)&&headSize>0?headSize:1;
 return {hips:Math.max(.08,span*.43),chest:Math.max(.10,span*.50),head:Math.max(.10,span*.49*size)};
}

export type SocialAction=string;
export const socialActions=Object.fromEntries(selectedMotions.map(e=>[e.id,{...e,duration:e.id==='home-passion-kiss'?12:e.id==='home-sneak-kiss'?5:e.id==='home-kiss'?9.6:e.id==='home-rear-hug'?7.5:e.id==='home-hand-hold-plead'?6.7:e.id==='home-sofa-lap-pillow'?9.3:e.duration+1.2}]));
export interface SocialResident {id:string;visitor:ChibiVisitor}
const yAxis=new T.Vector3(0,1,0),smooth=T.MathUtils.smootherstep;
/** Both roles share a clock and capture transform. Observers stay independent. */
/** Smooth travel on an existing planned path. Start and finish at rest,
* and sample neighbouring positions for continuous heading through bends.
* Pure in time/path: pause, seek, 30/60/120 Hz cannot accumulate drift.
* Does not create paths or move an actor outside the navigation waypoints. */
export function sampleSocialApproach(path:readonly T.Vector3[],time:number,duration:number){
 const start=path[0]?.clone()??new T.Vector3(),last=path.at(-1)??start;
 if(path.length<2||!Number.isFinite(duration)||duration<=0)return {position:last.clone(),heading:null as number|null,progress:1,speed:0};
 const lengths=path.slice(1).map((v,i)=>v.distanceTo(path[i]));
 const total=lengths.reduce((a,b)=>a+b,0);
 if(total<1e-8)return {position:last.clone(),heading:null as number|null,progress:1,speed:0};
 const t=T.MathUtils.clamp(Number.isFinite(time)?time:0,0,duration);
 const ramp=Math.min(.18,duration*.22),denom=duration-ramp;
 let traveled:number,speed:number;
 if(t<ramp){traveled=total*(t*t/(2*ramp))/denom;speed=total*t/(ramp*denom);}
 else if(t>duration-ramp){
  const left=duration-t;
  traveled=total*(1-left*left/(2*ramp*denom));
  speed=total*left/(ramp*denom);
 }else{traveled=total*(t-ramp*.5)/denom;speed=total/denom;}
 const positionAt=(distance:number)=>{
  let d=T.MathUtils.clamp(distance,0,total);
  for(let i=0;i<lengths.length;i++){
   if(d<=lengths[i]||i===lengths.length-1)return path[i].clone().lerp(path[i+1],lengths[i]>1e-8?T.MathUtils.clamp(d/lengths[i],0,1):0);
   d-=lengths[i];
  }
  return last.clone();
 };
 const position=positionAt(traveled),look=Math.min(.12,total*.2);
 const startPoint=positionAt(Math.max(0,traveled-look)),endPoint=positionAt(Math.min(total,traveled+look));
 const headingVector=endPoint.sub(startPoint);
 const heading=headingVector.lengthSq()>1e-8?Math.atan2(headingVector.x,headingVector.z):null;
 return {position,heading,progress:traveled/total,speed};
}

export function createSocialScene(residents:SocialResident[],options:{canInteract?:(action:string,a:string,b?:string)=>boolean;facingTarget?:T.Vector3;pinned?:{id:string;pose:any};onComplete?:()=>void;canPlace?:(paths:T.Vector3[][])=>boolean;canPerform?:(paths:T.Vector3[][])=>boolean;origins?:T.Vector3[];findPath?:(from:T.Vector3,to:T.Vector3)=>T.Vector3[]|null;sofaSeatPoses?:Record<string,any>}={}){
 if(new Set(residents.map(r=>r.id)).size!==residents.length)throw Error('Duplicate resident ID');
 if(residents.some(r=>!!r.visitor.rig!==!!residents[0]?.visitor.rig))throw Error('A home must use one body type');
 const states=new Map(residents.map(r=>[r.id,{...r,solver:contactSolver(r.visitor),home:r.visitor.root.position.clone(),rotation:r.visitor.root.quaternion.clone()}]));
 type Session={action:string;ids:string[];time:number;clip:SelectedClip;origin:T.Vector3;sourceOrigin:T.Vector3;rotation:T.Quaternion;scale:number;starts:T.Vector3[];turns:T.Quaternion[];paths:T.Vector3[][];approach:number;handSign:1|-1;passionPlan?:PassionKissPlan;sneakPlan?:SneakKissPlan};
 let session:Session|null=null,generation=0,loading=false;
 const pinned=options.pinned, pinnedState=pinned?states.get(pinned.id):undefined;
 const pinnedPosition=pinnedState?.home.clone(),pinnedRotation=pinnedState?.rotation.clone();
 const holdPinned=()=>{if(pinnedState&&pinned){pinnedState.visitor.root.position.copy(pinnedPosition!);pinnedState.visitor.root.quaternion.copy(pinnedRotation!);pinnedState.visitor.animate(0,'idle','seated',pinned.pose);}};
 const motionScope=createMotionTemplateScope();
 let prop:ReturnType<typeof createSocialProp>=null;
 const finish=()=>{for(const r of states.values())r.visitor.finishPose();};
 function locations(s:Session,time:number){
  if(s.action==='home-sofa-lap-pillow')return s.starts.map(p=>p.clone());
  if(s.passionPlan)return s.passionPlan.roots.map((p,i)=>p.clone().addScaledVector(s.passionPlan!.retreat,i===0?1-passionKissPhase(time).step:0));
  if(s.sneakPlan)return [s.sneakPlan.stance.clone().addScaledVector(s.sneakPlan.step,sneakKissPhase(time).step),s.starts[1].clone()];
  const points=s.clip.actors.map(a=>{const elapsed=T.MathUtils.clamp(pinned?0:time,0,a.duration);let i=0;while(i<a.times.length-2&&a.times[i+1]<elapsed)i++;const j=Math.min(i+1,a.times.length-1),f=i+(elapsed-a.times[i])/(a.times[j]-a.times[i]||1);return new T.Vector3().fromArray(a.positions,i*3).lerp(new T.Vector3().fromArray(a.positions,j*3),f-i).sub(s.sourceOrigin).setY(0).multiplyScalar(s.scale).applyQuaternion(s.rotation).add(s.origin);});
  if(points.length===2&&s.action!=='home-rear-hug'&&s.action!=='home-hand-hold-plead'){const delta=points[1].clone().sub(points[0]),gap=delta.length(),minimum=residents[0].visitor.rig?.66:1.38;if(gap<minimum){if(gap<.001)delta.set(1,0,0);delta.normalize().multiplyScalar((minimum-gap)/2);points[0].sub(delta);points[1].add(delta);}}
   if(s.action==='home-rear-hug'&&points.length===2){
    // B holds their current location; A arrives at a compact waist-contact distance.
    const distance=.57;
    points[0].copy(points[1]).add(new T.Vector3(0,0,-distance).applyQuaternion(s.rotation));
   }
  if(s.action==='home-hand-hold-plead'&&points.length===2){
   // B remains where they were; only A walks to a short-arm side contact.
   points[0].copy(pleadStandingPoint(points[1],s.rotation,s.handSign));
   points[0].y=s.starts[0].y;
   points[1].y=s.starts[1].y;
  }
  if(pinned){const index=s.ids.indexOf(pinned.id);if(index>=0){const offset=pinnedPosition!.clone().sub(points[index]);points.forEach((p,i)=>{p.add(offset);if(i!==index)p.y=s.starts[i].y;});}}
  if(pinned&&(s.action==='cmu-22_09'||s.action==='home-hug')){
   const seated=s.ids.indexOf(pinned.id),standing=1-seated;
   const distance=residents[0].visitor.rig?(s.action==='cmu-22_09'?1.2:1.0):1.4;
   const offset=new T.Vector3(0,0,(s.action==='cmu-22_09'?-1:1)*distance).applyQuaternion(pinnedRotation!);
   points[seated].copy(pinnedPosition!);points[standing].copy(pinnedPosition!).add(offset);points[standing].y=s.starts[standing].y;
  }
  return points;
 }
 const palm=(v:ChibiVisitor,side:string)=>v.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side as 'L'|'R'));
function contacts(both:NonNullable<ReturnType<typeof states.get>>[],frames:MotionFrame[],weight:number){
  if(both.length!==2)return;
  if(session?.action==='home-hug'){
   both.forEach((owner,i)=>{const partner=both[1-i]!;
    for(const side of ['L','R'] as const){
     const opposite=side==='L'?'R':'L';
     const target=partner.visitor.rig?partner.visitor.rig.bones[opposite+'_upperArm'].getWorldPosition(new T.Vector3()):partner.visitor.classicPoint(opposite+'_upperArm');
     // Wrap toward the partner's back, with arms staggered to avoid interlocking.
     const q=partner.visitor.root.getWorldQuaternion(new T.Quaternion());
     target.add(new T.Vector3(0,i===0?-.08:-.14,-.18).applyQuaternion(q));
     if(owner!.solver)owner!.solver({side,point:target,direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(q),normal:new T.Vector3(0,1,0),curl:.12},weight);
     else owner!.visitor.classicContact(side,target,weight);
    }
   });return;
  }
  // Stage 1: three established paired-hand actions share one configured
  // runtime. The same IK solver and cached source-pair selection are retained.
  const profile=motionTemplateContact(session!.action);
  if(profile?.kind==='pairedHands'){
   const [a,b]=both;
   if(a&&b&&applyPairedHandContact(profile,session!.clip,[a,b],weight,session!.time-session!.approach))return;
  }
  // Arm wrestling must keep one hand pair throughout the contest.
  // Generic nearest-hand detection can switch partners as the wrists rotate.
  if(session?.action==='cmu-22_17'){
   const [left,right]=both;
   if(left?.visitor.rig&&right?.visitor.rig&&left.solver&&right.solver){
    const pairs=[['R','R'],['R','L'],['L','R'],['L','L']] as const;
    const [sideA,sideB]=pairs.map(pair=>({
     pair,d:frames[0].points[pair[0]+'_hand'].distanceTo(frames[1].points[pair[1]+'_hand'])
    })).sort((a,b)=>a.d-b.d)[0].pair;
    // Both palms are sampled before solving either arm. Keep the grip
    // throughout the clip instead of dropping it at the generic threshold.
    const target=sharedPalmTarget(palm(left.visitor,sideA),palm(right.visitor,sideB));
    const contactWeight=weight;
    for(const [resident,side] of [[left,sideA],[right,sideB]] as const){
     const hand=resident.visitor.rig!.bones[side+'_hand'];
     const q=hand.getWorldQuaternion(new T.Quaternion());
     resident.solver({side,point:target.clone(),direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(q),normal:new T.Vector3(0,1,0).applyQuaternion(q),curl:.72},contactWeight);
    }
    return;
   }
  }
  const handled=new Set<string>();
  for(let i=0;i<2;i++)for(const side of ['L','R'] as const){
   const from=side+'_hand',a=frames[i].points[from],j=1-i;
   const passing=session!.action==='cmu-22_13'||motionTemplateFor(session!.action)?.prop?.kind==='cup';
   if(passing)continue; // The cup owns the two opposed grip targets during handover.
   const bodyProfile=profile?.kind==='bodyTouch'?profile:null;
   const choices=(passing?[i===0?'R_hand':'L_hand']:bodyProfile?bodyProfile.targetBones:['L_hand','R_hand']).map(n=>({n,d:a.distanceTo(frames[j].points[n])})).sort((a,b)=>a.d-b.d),nearest=choices[0];
   const near=bodyProfile?.near??(passing?.5:.20),far=bodyProfile?.far??(passing?.6:.36);
   if(nearest.d>far||handled.has(i+from))continue;
   const owner=both[i]!,partner=both[j]!;
   if(!owner.visitor.rig){
    const target=partner.visitor.classicPoint(nearest.n),w=weight*(1-smooth(nearest.d,near,far));
    if(nearest.n.endsWith('hand')){target.lerp(owner.visitor.classicPoint(from),.5);partner.visitor.classicContact(nearest.n[0] as 'L'|'R',target,w);handled.add(j+nearest.n);}
    owner.visitor.classicContact(side,target,w);handled.add(i+from);continue;
   }
   const hand=owner.visitor.rig.bones[from],other=partner.visitor.rig!.bones[nearest.n];
   const target=nearest.n.endsWith('hand')?palm(partner.visitor,nearest.n[0]).lerp(palm(owner.visitor,side),.5):other.getWorldPosition(new T.Vector3()).add(new T.Vector3(nearest.n[0]==='L'?.04:-.04,.025,0).applyQuaternion(partner.visitor.root.getWorldQuaternion(new T.Quaternion())));
   // A paired hand contact has one immutable goal for this frame. Capture
   // both palm positions BEFORE either arm is solved, so the second hand
   // cannot chase the first hand's newly modified pose.
   const paired=nearest.n.endsWith('hand');
   const shared=paired?sharedPalmTarget(palm(owner.visitor,side),palm(partner.visitor,nearest.n[0])):null;
   if(shared)target.copy(shared);
   const contactWeight=weight*(1-smooth(nearest.d,near,far));
   const q=hand.getWorldQuaternion(new T.Quaternion()),direction=new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(q),normal=new T.Vector3(0,1,0).applyQuaternion(q);
   owner.solver!({side,point:target,direction,normal,curl:nearest.n.endsWith('hand')?.35:0},contactWeight);
   if(nearest.n.endsWith('hand')){const otherSide=nearest.n[0] as 'L'|'R',oq=other.getWorldQuaternion(new T.Quaternion());partner.solver!({side:otherSide,point:target.clone(),direction:new T.Vector3(otherSide==='L'?1:-1,0,0).applyQuaternion(oq),normal:new T.Vector3(0,1,0).applyQuaternion(oq),curl:.35},contactWeight);handled.add(j+nearest.n);}
   handled.add(i+from);
  }
 }

 /**
  * These two existing corrections are kept byte-for-byte in their body logic:
  * only their invocation is routed through the optional Stage 2 schedule.
  * For un-migrated actions they still run in the original order.
  */
 function correctPairedBodies(both:NonNullable<ReturnType<typeof states.get>>[]){
  const s=session;
  if(!s)return;
  // Lightweight paired torso/pelvis collision proxies; no mesh scan.
  // Preserve close-contact intimacy and pinned poses for their own solvers.
  if(!pinned&&both.length===2&&both.every(r=>!!r.visitor.rig)&&!isIntimacy(s.action)){
   const a=both[0].visitor,b=both[1].visitor;
   const sizes=[a,b].map(v=>{
    const shoulders=v.rig!.bones.L_upperArm.getWorldPosition(new T.Vector3())
     .distanceTo(v.rig!.bones.R_upperArm.getWorldPosition(new T.Vector3()));
    return socialBodyCollisionRadii(shoulders);
   });
   let penetration=0;
   const direction=new T.Vector3();
   for(const bone of ['hips','chest'] as const){
    const pa=a.rig!.bones[bone].getWorldPosition(new T.Vector3());
    const pb=b.rig!.bones[bone].getWorldPosition(new T.Vector3());
    const delta=pb.sub(pa),vertical=Math.abs(delta.y);
    const combined=sizes[0][bone]+sizes[1][bone];
    if(vertical>=combined)continue;
    delta.y=0;
    const gap=delta.length(),minimum=Math.sqrt(Math.max(0,combined*combined-vertical**2));
    if(gap<minimum&&minimum-gap>penetration){
     penetration=minimum-gap;
     if(gap>.0001)direction.copy(delta).divideScalar(gap);
    }
   }
   if(penetration>.0001){
    if(direction.lengthSq()<.5){direction.copy(b.root.position).sub(a.root.position).setY(0);if(direction.lengthSq()<.0001)direction.set(1,0,0);direction.normalize();}
    direction.multiplyScalar(Math.min(penetration,.10)*.5);
    a.root.position.sub(direction);b.root.position.add(direction);
    a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
   }
  }
 }
 function correctHeadClearance(both:NonNullable<ReturnType<typeof states.get>>[],points:T.Vector3[]){
  const s=session;
  if(!s)return;
  // The head has very different proportions from the source human. Separate
  // the actual posed head centres before solving hands, including height gaps.
  if(!pinned&&both.length===2&&both[0].visitor.rig&&!isIntimacy(s.action)){
   const heads=both.map(r=>r.visitor.rig!.bones.head.localToWorld(new T.Vector3(0,.72,0))),delta=heads[1].clone().sub(heads[0]),vertical=delta.y;delta.y=0;
   const headRadii=both.map(r=>{
    const rig=r.visitor.rig!,span=rig.bones.L_upperArm.getWorldPosition(new T.Vector3())
     .distanceTo(rig.bones.R_upperArm.getWorldPosition(new T.Vector3()));
    return socialBodyCollisionRadii(span,rig.mesh.geometry.userData.headSize??1).head;
   });
   const combined=headRadii[0]+headRadii[1];
   const needed=Math.sqrt(Math.max(0,combined*combined-vertical**2)),gap=delta.length();
   if(gap<needed){if(gap<.001)delta.copy(points[1]).sub(points[0]);delta.normalize().multiplyScalar((needed-gap)/2);both[0].visitor.root.position.sub(delta);both[1].visitor.root.position.add(delta);both.forEach(r=>r.visitor.root.updateWorldMatrix(true,true));}
  }
 }
 function presentPostPose(both:NonNullable<ReturnType<typeof states.get>>[],sourceTime:number,actionTime:number,weight:number){
  const s=session!;
  prop?.update(sourceTime,s.clip.duration,weight);for(const [index,r] of both.entries())r.visitor.setActionExpression(s.passionPlan?(sourceTime<11.5?'smiling':'neutral'):s.sneakPlan?sneakKissExpression(index as 0|1,sourceTime):isSeasonalSocial(s.action)?seasonalExpression(s.action,sourceTime,index):actionTime<s.clip.duration? actionExpression(s.action,socialActions[s.action].category,socialActions[s.action].label):'neutral',sourceTime);finish();
 }
 // One stable set of callbacks per scene; frame data reuses this object.
 // No scheduler allocations, phase sorting or IK re-creation per frame.
 const constraintFrame={
  both:[] as NonNullable<ReturnType<typeof states.get>>[],
  frames:[] as MotionFrame[],
  points:[] as T.Vector3[],
  weight:0,sourceTime:0,actionTime:0,
 };
 const constraintPipeline=createMotionConstraintPipeline({
  bodyPlacement:()=>{
   correctPairedBodies(constraintFrame.both);
   const template=motionTemplateFor(session!.action),mode=template?.standingHeight;
   if(!pinned&&mode&&mode!=='none'&&constraintFrame.both.length===2){
    const actionTime=constraintFrame.actionTime;
    const headPat=!!template?.headTouch;
    // Start after approach; smoothly stand up again as the head pat releases.
    const fade=headPat?T.MathUtils.smootherstep(actionTime,.18,.98)*
     (1-T.MathUtils.smootherstep(actionTime,6.65,7.65)):1;
    applyStandingHeightAdaptation(
     [constraintFrame.both[0].visitor,constraintFrame.both[1].visitor],
     {mode,actorIndex:headPat?0:undefined,weight:constraintFrame.weight*fade}
    );
   }
  },
  clearance:()=>correctHeadClearance(constraintFrame.both,constraintFrame.points),
  contactIK:()=>{
   const template=motionTemplateFor(session!.action);
   if(isSeasonalSocial(session!.action))poseSeasonalSocial(session!.action,constraintFrame.both,constraintFrame.sourceTime);
   else if(template?.headTouch&&constraintFrame.both.length===2){
    applyHeadPatMotion(template.headTouch,[constraintFrame.both[0],constraintFrame.both[1]],
     constraintFrame.actionTime,constraintFrame.weight);
   }else{
    if(!template?.face||template.contact)contacts(constraintFrame.both,constraintFrame.frames,constraintFrame.weight);
    if(template?.face&&constraintFrame.both.length===2)applyTemplateFaceContact(
     template.face,
     [constraintFrame.both[0].visitor,constraintFrame.both[1].visitor],
     constraintFrame.actionTime,constraintFrame.weight
    );
   }
  },
  presentation:()=>{
   presentPostPose(constraintFrame.both,constraintFrame.sourceTime,constraintFrame.actionTime,constraintFrame.weight);
   const recipe=motionTemplateFor(session!.action)?.headTouch;
   if(recipe&&constraintFrame.both.length===2)applyHeadPatExpressions(recipe,
    [constraintFrame.both[0],constraintFrame.both[1]],constraintFrame.actionTime);
  },
 },motionTemplateConstraintPlans);

 function draw(){
  if(!session){for(const r of states.values())if(r.id!==pinned?.id){
   const seat=options.sofaSeatPoses?.[r.id];
   r.visitor.animate(0,'idle',seat?'seated':'standing',seat);
  }holdPinned();finish();return;}
  const s=session;
  if(s.time<s.approach){
   s.ids.forEach((id,i)=>{
    if(id===pinned?.id){holdPinned();return;}
    const v=states.get(id)!.visitor,approach=sampleSocialApproach(s.paths[i],s.time,s.approach);
    v.root.position.copy(approach.position);
    if(approach.heading!==null){
     const q=new T.Quaternion().setFromAxisAngle(yAxis,approach.heading);
     v.root.quaternion.copy(s.turns[i]).slerp(q,smooth(s.time,0,Math.min(.3,s.approach*.3)));
     // The gait clock uses actual world displacement, including acceleration.
     v.animate(s.time,'walk');
    }else v.animate(s.time,'idle');
   });finish();return;
  }
  const actionTime=s.time-s.approach,kissAction=s.action==='home-kiss',rearHug=s.action==='home-rear-hug',handPlead=s.action==='home-hand-hold-plead',sofaPillow=s.action==='home-sofa-lap-pillow',sneak=!!s.sneakPlan,sourceTime=T.MathUtils.clamp(kissAction?Math.max(0,actionTime-.15)+1.5:rearHug||handPlead||sofaPillow||sneak||!!s.passionPlan?actionTime:actionTime-.6,0,s.clip.duration),weight=kissAction?smooth(actionTime,0,.25):rearHug||handPlead||sofaPillow||sneak||!!s.passionPlan?1:smooth(actionTime,0,.6)*(1-smooth(actionTime,s.clip.duration+.6,s.clip.duration+1.2));
  const both=s.ids.map(id=>states.get(id)!),frames=s.clip.actors.map(a=>sampleSelected(a,sourceTime)),points=kissAction&&!pinned?locations(s,3.5):locations(s,sourceTime);
  // Kiss has one destination: approach reaches it, then the roots remain fixed.
  for(const r of states.values())if(!s.ids.includes(r.id))r.visitor.animate(s.time,'idle');
  both.forEach((r,i)=>{
   if(r.id===pinned?.id){holdPinned();if(!isIntimacy(s.action))r.visitor.applySelectedFrame(frames[i],weight,pinned.pose);r.visitor.root.updateWorldMatrix(true,true);return;}
   r.visitor.root.position.copy(points[i]);const path=s.paths[i],last=path.at(-1)!,previous=path.at(-2)??last,turn=last.distanceTo(previous)>.001?new T.Quaternion().setFromAxisAngle(yAxis,Math.atan2(last.x-previous.x,last.z-previous.z)):s.turns[i];r.visitor.root.quaternion.copy(turn).slerp(s.rotation,smooth(actionTime,0,.6));
   if(r.visitor.rig&&['cmu-22_07','cmu-22_05','cmu-22_04','cmu-22_09'].includes(s.action))for(const n of ['hips','spine','chest','neck','head']){
    const q=frames[i].rotations[n],e=new T.Euler().setFromQuaternion(q,'YXZ'),limit=n==='head'?.08:n==='neck'?.06:n==='hips'?.04:.05;
    e.x=T.MathUtils.clamp(e.x,-limit,limit);e.z=T.MathUtils.clamp(e.z,-limit,limit);q.setFromEuler(e);
   }
   // Shared height adaptation is applied after the sampled pose in the
   // bodyPlacement phase; do not add another independent knee bend here.
   if(s.passionPlan){
    r.visitor.root.quaternion.copy(turn).slerp(s.passionPlan.headings[i],smooth(actionTime,0,.65));
    r.visitor.animate(0,'idle');
   }else if(s.sneakPlan){
    r.visitor.root.quaternion.copy(i===1?s.turns[1]:turn).slerp(i===1?s.turns[1]:s.sneakPlan.heading,smooth(actionTime,0,1.25));
    r.visitor.animate(0,'idle');
   }else if(sofaPillow){
    // No standing idle/walk overlay: both roots stay on their real sofa seats.
    r.visitor.root.quaternion.copy(s.turns[i]);
    r.visitor.animate(0,'idle','seated',options.sofaSeatPoses?.[r.id]);
   // Halloween capture clips need their sampled bone frames like other paired actions.
    // Keep intimacy/head-touch adapters idle-only; do not redirect seasonal clips.
    }else if(isIntimacy(s.action)||motionTemplateFor(s.action)?.headTouch){
    const other=points[1-i],toward=new T.Quaternion().setFromAxisAngle(yAxis,Math.atan2(other.x-points[i].x,other.z-points[i].z));
    r.visitor.root.quaternion.copy(turn).slerp(rearHug?s.rotation:toward,smooth(actionTime,0,.6));
    // No custom walking or late retreat once B is reached.
    r.visitor.animate(sourceTime,'idle');
    if(isPrincessCarry(s.action)&&r.visitor.rig){
     // Apply the 30 Hz captured torso and secondary motion first. The local
     // pair solver still owns lift, two support palms and floor clearance.
     prepareCarryFrame(frames[i],sourceTime);
     r.visitor.applySelectedFrame?.(frames[i],carryCaptureWeight(sourceTime));
    }
   }else{
    const {heading,lean}=splitMotionHeading(frames[i].rotations.hips);
    // The sampled pelvis already contains this actor's capture heading. Put it
    // on the root before blending from the approach (and back out to idle).
    // At full weight root * lean is exactly the original root * pelvis pose.
    const facing=pinned&&s.action==='cmu-22_09'?pinnedRotation!.clone():s.rotation.clone().multiply(heading);
    r.visitor.root.quaternion.copy(turn).slerp(facing,smooth(actionTime,0,.6));
    if(both.length===2&&!(pinned&&s.action==='cmu-22_09')){const other=points[1-i],toward=new T.Quaternion().setFromAxisAngle(yAxis,Math.atan2(other.x-points[i].x,other.z-points[i].z));r.visitor.root.quaternion.slerp(toward,smooth(actionTime,s.clip.duration+.6,s.clip.duration+1.2));}
    frames[i].rotations.hips=lean;
    // Classic reconstructs hand offsets from capture points instead of bones.
    // Rotate those offsets into the same heading-free space, while contacts
    // continue reading the untouched paired capture coordinates in frames.
    const frame=frames[i],inverse=heading.clone().invert();
    const poseFrame=r.visitor.rig?frame:{...frame,points:Object.fromEntries(Object.entries(frame.points).map(([name,p])=>[name,p.clone().sub(frame.position).applyQuaternion(inverse).add(frame.position)]))};
    r.visitor.applySelectedFrame(poseFrame,weight);
   }
   r.visitor.root.updateWorldMatrix(true,true);
  });
  // Opted-in contact profiles share the same ordered constraints. Intimate
  // actions and specialized seated adapters keep their reviewed legacy route.
  if(constraintPipeline.phases){
   constraintFrame.both=both;
   constraintFrame.frames=frames;
   constraintFrame.points=points;
   constraintFrame.weight=weight;
   constraintFrame.sourceTime=sourceTime;
   constraintFrame.actionTime=actionTime;
   constraintPipeline.run();
  }else{
   correctPairedBodies(both);
   correctHeadClearance(both,points);
  if(s.action==='home-kiss'&&!pinned&&both.length===2&&both.every(r=>!!r.visitor.rig)){
   // Align the actual heads, not the two navigation roots. Preserve a small
   // face gap so the large chibi heads cannot pass through one another.
   const v0=both[0].visitor,v1=both[1].visitor;
   const h0=v0.getHeadWorldPosition(),h1=v1.getHeadWorldPosition();
   const delta=h1.clone().sub(h0),horizontal=new T.Vector3(delta.x,0,delta.z);
   const gap=horizontal.length(),targetGap=.66;
   if(gap>.001){
    const contact=smooth(sourceTime,3.4,5.1);
    const shift=T.MathUtils.clamp(gap-targetGap,-.14,.24)*contact*.5;
    const direction=horizontal.normalize().multiplyScalar(shift);
    v0.root.position.add(direction);v1.root.position.sub(direction);
    v0.root.updateWorldMatrix(true,true);v1.root.updateWorldMatrix(true,true);
   }
  }
   if(s.passionPlan)posePassionKiss(both,sourceTime,s.passionPlan);
   else if(s.sneakPlan)poseSneakKiss(both[0].visitor,both[1].visitor,sourceTime,s.sneakPlan);
   else if(isSeasonalSocial(s.action))poseSeasonalSocial(s.action,both,sourceTime);
   else if(isIntimacy(s.action)&&both[0].visitor.rig)poseIntimacy(s.action,both,sourceTime,pinned?s.ids.indexOf(pinned.id):undefined,s.handSign);else contacts(both,frames,weight);
   presentPostPose(both,sourceTime,actionTime,weight);
  }
 }
 const restore=()=>{
  const last=session;
  constraintPipeline.reset();
  // A disposed temporary prop can throw, but must never block session reset.
  // The scope always attempts all disposals; preserve any error for diagnostics.
  const releaseError=motionScope.stopSafely();
  prop=null;session=null;
  if(releaseError)console.warn('[Home3D] temporary motion resource release failed',releaseError);
  if(last?.action==='home-sofa-lap-pillow'){
   // At the very last frame keep BOTH seated; ordinary restore's idle-standing
   // would make the lap-pillow end with a one-frame pop off the cushion.
   last.ids.forEach((id,i)=>{
    const resident=states.get(id)!;
    resident.visitor.root.position.copy(last.starts[i]);
    resident.visitor.root.quaternion.copy(last.turns[i]);
    resident.visitor.animate(0,'idle','seated',options.sofaSeatPoses?.[id]);
   });
   finish();
  }else draw();
 };
 return {
  get active(){return !!session;},
  async start(action:SocialAction,a:string,b?:string){
   const entry=socialActions[action];if(!entry)throw Error('这个动作没有被选中');
   if(!states.has(a)||entry.participants===2&&(!b||!states.has(b)||a===b))throw Error('请选择两位不同的居民');
   const checkRelation=()=>{if(options.canInteract&&!options.canInteract(action,a,b))throw Error('这两位未设置浪漫关系，不能执行亲密动作');};
   checkRelation();
   if(isSeasonalSocial(action)&&pinned)throw Error('万圣节双人互动需要两个人先站起来');
    if(isPrincessCarry(action)){
     if(pinned)throw Error('公主抱需要两个人先站起来');
     if(!states.get(a)!.visitor.rig||!states.get(b!)!.visitor.rig)throw Error('公主抱需要两个人都使用 Q 版骨骼素体');
    }
   if(action==='home-rear-hug'&&(!states.get(a)!.visitor.rig||!states.get(b!)!.visitor.rig))throw Error('背后搂抱需要 Q 版骨骼素体');
   if(['home-sneak-kiss','home-passion-kiss'].includes(action)&&(!states.get(a)!.visitor.rig||!states.get(b!)!.visitor.rig))throw Error(entry.label+'需要 Q 版骨骼素体');
   if(action==='home-sofa-lap-pillow'&&(!states.get(a)!.visitor.rig||!states.get(b!)!.visitor.rig))throw Error('沙发膝枕需要 Q 版骨骼素体');
   const token=++generation;restore();loading=true;
   try{const [sourceClip,propModels]=await Promise.all([loadSelectedMotion(action),loadHalloweenProps(action)]);if(token!==generation)return false;
    checkRelation();
    // This capture stores the seated recipient first and the crouching comforter second.
    // Keep semantic participant IDs (initiator, recipient) stable; only map the tracks.
    const clip=action==='cmu-22_03'?{...sourceClip,actors:[sourceClip.actors[1],sourceClip.actors[0]]}:sourceClip;
    const ids=entry.participants===2?(action==='home-princess-carried'?[b!,a]:[a,b!]):[a],both=ids.map(id=>states.get(id)!.visitor),starts=both.map(v=>v.root.position.clone()),turns=both.map(v=>v.root.quaternion.clone());
    const sourceOrigin=clip.actors.reduce((p,c)=>p.add(new T.Vector3().fromArray(c.positions)),new T.Vector3()).multiplyScalar(1/both.length);sourceOrigin.y=0;
    const origin=starts.reduce((p,c)=>p.add(c),new T.Vector3()).multiplyScalar(1/both.length),scale=both.reduce((n,v)=>n+v.motionScale,0)/both.length;
    const sourceAxis=clip.actors.length===2?new T.Vector3().fromArray(clip.actors[1].positions).sub(new T.Vector3().fromArray(clip.actors[0].positions)):new T.Vector3(0,0,1),axis=starts.length===2?starts[1].clone().sub(starts[0]):new T.Vector3(0,0,1).applyQuaternion(turns[0]);
    const rotation=new T.Quaternion().setFromAxisAngle(yAxis,Math.atan2(axis.x,axis.z)-Math.atan2(sourceAxis.x,sourceAxis.z));
    if(ids.length===1&&options.facingTarget){const direction=options.facingTarget.clone().sub(starts[0]);if(direction.lengthSq()>.0001)rotation.setFromAxisAngle(yAxis,Math.atan2(direction.x,direction.z));}
    if(pinned){const i=ids.indexOf(pinned.id),sourceHeading=splitMotionHeading(sampleSelected(clip.actors[i],0).rotations.hips).heading;rotation.copy(pinnedRotation!).multiply(sourceHeading.invert());}
    const candidate={action,ids,time:0,clip,origin,sourceOrigin,rotation,scale,starts,turns,paths:[] as T.Vector3[][],approach:0,handSign:1 as 1|-1,passionPlan:undefined as PassionKissPlan|undefined,sneakPlan:undefined as SneakKissPlan|undefined};
    if(action==='home-passion-kiss')candidate.passionPlan=planPassionKiss(both[0],both[1]);
    if(action==='home-sneak-kiss'){
     const right=new T.Vector3(1,0,0).applyQuaternion(turns[1]);
     candidate.handSign=starts[0].clone().sub(starts[1]).dot(right)>=0?1:-1;
     candidate.sneakPlan=planSneakKiss(both[0],both[1],candidate.handSign);
     if(!candidate.sneakPlan.surfaceValid)throw Error('模型脸部接触点读取失败，请重新加载人物后再试');
    }
    if(action==='home-sofa-lap-pillow'){
     if(!ids.every(id=>options.sofaSeatPoses?.[id]))throw Error('请先让两个人坐在同一张双人沙发的不同座位上');
     candidate.paths=starts.map(p=>[p.clone(),p.clone()]);
     session=candidate;motionScope.begin(action);constraintPipeline.activate(action);
     draw();return true;
    }
    if(action==='home-rear-hug'){
     // The receiver retains their standing position and orientation.
     // The initiator travels around the receiver, not through them.
     candidate.rotation.copy(turns[1]);
     const bSource=new T.Vector3().fromArray(clip.actors[1].positions).sub(sourceOrigin).setY(0);
     candidate.origin.copy(starts[1]).sub(bSource.multiplyScalar(scale).applyQuaternion(candidate.rotation));
    }
    if(action==='home-hand-hold-plead'){
     // Try the nearest B-side first; use the opposite side when the existing
     // room path or clearance predicate rejects the first position.
     candidate.rotation.copy(turns[1]);
     const right=new T.Vector3(1,0,0).applyQuaternion(candidate.rotation);
     candidate.handSign=starts[0].clone().sub(starts[1]).dot(right)<0?-1:1;
     const bSource=new T.Vector3().fromArray(clip.actors[1].positions).sub(sourceOrigin).setY(0);
     candidate.origin.copy(starts[1]).sub(bSource.multiplyScalar(scale).applyQuaternion(candidate.rotation));
    }
    const fits=()=>{
     const first=locations(candidate,0);
     const target=action==='home-kiss'&&!pinned?locations(candidate,3.5):first;
     const moving=(paths:T.Vector3[][])=>paths.filter((_,i)=>ids[i]!==pinned?.id&&(!['home-rear-hug','home-hand-hold-plead','home-sneak-kiss','home-passion-kiss'].includes(action)||i===0));
     // The existing tests are unchanged, but reject impossible action space
     // BEFORE expensive pathfinding for any of the alternate positions.
     const motion=both.map(()=>[] as T.Vector3[]);
     for(let t=0;t<=clip.duration+.001;t+=.1)(action==='home-kiss'&&!pinned?locations(candidate,3.5):locations(candidate,Math.min(t,clip.duration))).forEach((p,i)=>motion[i].push(p));
     const perform=options.canPerform||options.canPlace;
     if(perform&&!perform(moving(motion)))return false;
     // The final roots must remain on valid standing floor.
     if(options.canPlace&&!options.canPlace(moving((action==='home-kiss'&&!pinned?locations(candidate,3.5):locations(candidate,clip.duration)).map(p=>[p]))))return false;
     const paths=both.map(()=>[] as T.Vector3[]);
     const routes=starts.map((p,i)=>ids[i]===pinned?.id||['home-rear-hug','home-hand-hold-plead','home-sneak-kiss','home-passion-kiss'].includes(action)&&i===1?[p.clone(),p.clone()]:
     ['home-sneak-kiss','home-passion-kiss'].includes(action)&&i===0?planSneakKissApproach(p,target[i],both[1],both[0],
      (from,to)=>options.findPath?options.findPath(from,to):[from.clone(),to.clone()]):
     action==='home-rear-hug'&&i===0?planRearHugApproach(p,target[i],target[1],candidate.rotation,
      (from,to)=>options.findPath?options.findPath(from,to):[from.clone(),to.clone()]):
     options.findPath?options.findPath(p,target[i]):[p.clone(),target[i].clone()]);
     if(routes.some(p=>!p?.length))return false;
     candidate.paths=routes as T.Vector3[][];
     candidate.approach=Math.max(...candidate.paths.map((path,i)=>path.slice(1).reduce((n,p,j)=>n+p.distanceTo(path[j]),0)/((both[i].walkSpeed??1.05)*(action==='home-kiss'?1.65:1))));
     for(let i=0;i<routes.length;i++)for(let j=1;j<routes[i]!.length;j++){
      const from=routes[i]![j-1],to=routes[i]![j],steps=Math.max(1,Math.ceil(from.distanceTo(to)/.08));
      for(let step=0;step<=steps;step++)paths[i].push(from.clone().lerp(to,step/steps));
     }
     // A may already be standing very close to furniture: existing start positions
     // are valid by occupancy, and the nav planner owns the route from there.
     if(['home-rear-hug','home-hand-hold-plead','home-sneak-kiss','home-passion-kiss'].includes(action)&&paths[0].length>1)paths[0].shift();
     return !options.canPlace||options.canPlace(moving(paths));
    };
    let valid=fits();
    if(!valid&&action==='home-sneak-kiss'){
     candidate.handSign=candidate.handSign===1?-1:1;
     candidate.sneakPlan=planSneakKiss(both[0],both[1],candidate.handSign);
     valid=candidate.sneakPlan.surfaceValid&&fits();
    }
    if(!valid&&action==='home-hand-hold-plead'){
     candidate.handSign=candidate.handSign===1?-1:1;
     valid=fits();
    }
    if(!valid&&pinned&&action!=='cmu-22_09'&&action!=='home-hug'){const base=rotation.clone();for(const angle of [.35,-.35,.7,-.7,1.1,-1.1,Math.PI]){candidate.rotation=base.clone().multiply(new T.Quaternion().setFromAxisAngle(yAxis,angle));if(fits()){valid=true;break;}}}if(!valid&&!pinned&&action!=='home-rear-hug'&&action!=='home-hand-hold-plead'&&action!=='home-sneak-kiss'&&action!=='home-passion-kiss')for(const alternative of options.origins??[]){candidate.origin=alternative.clone();if(fits()){valid=true;break;}}
    if(!valid)throw Error(action==='cmu-22_09'?'坐着的人身后没有可站立的位置，请先给椅背后留出空地':'这段动作需要更大的空地，先移动居民或挪开家具');
    session=candidate;motionScope.begin(action);constraintPipeline.activate(action);
     prop=motionScope.own(isSeasonalSocial(action)?createHalloweenProp(action,both,propModels):createSocialProp(action,both,motionTemplateFor(action)?.prop));
     draw();return true;
   }catch(error){
    // A synchronous pose/prop failure after activation must not leave a live
    // half-created session. A stale load must never clear a newer session.
    if(token===generation)restore();
    throw error;
   }finally{if(token===generation)loading=false;}
  },
  advance(seconds:number){if(!Number.isFinite(seconds)||seconds<0)return;if(session){
   const before=session.ids.map(id=>{const root=states.get(id)!.visitor.root;return {position:root.position.clone(),rotation:root.quaternion.clone()};});
   session.time=Math.min(session.time+seconds,socialActions[session.action].duration+session.approach);
   try{draw();}catch(error){restore();throw error;}
   // Check the swept root path BEFORE the renderer sees this frame. The room
   // caches geometry by layout revision; no path search runs here. Seat-owned
   // interactions retain their dedicated occupancy rules.
   if(session&&options.canPerform&&!pinned&&!options.sofaSeatPoses){
    const current=session.ids.map((id,i)=>[before[i].position,states.get(id)!.visitor.root.position.clone()]);
    if(!options.canPerform(current)){
     session.ids.forEach((id,i)=>{const root=states.get(id)!.visitor.root;root.position.copy(before[i].position);root.quaternion.copy(before[i].rotation);});
     restore();return;
    }
   }
   if(session&&session.time>=socialActions[session.action].duration+session.approach){if(session.action==='home-kiss'){for(const id of session.ids){const resident=states.get(id);if(resident){resident.home.copy(resident.visitor.root.position);resident.rotation.copy(resident.visitor.root.quaternion);}}}restore();options.onComplete?.();}}},
  seek(seconds:number){if(session&&Number.isFinite(seconds)){session.time=T.MathUtils.clamp(seconds,0,socialActions[session.action].duration+session.approach);try{draw();}catch(error){restore();throw error;}}},
  cancel(){generation++;loading=false;restore();},
  reset(){generation++;loading=false;restore();for(const r of states.values()){r.visitor.root.position.copy(r.home);r.visitor.root.quaternion.copy(r.rotation);}draw();},
  inspect(){return {loading,session:session&&{action:session.action,participants:session.ids,time:session.time,duration:socialActions[session.action].duration+session.approach,phase:session.time<session.approach?'approach':session.time<session.approach+.6?'enter':session.time>session.approach+session.clip.duration+.6?'release':'perform'},residents:residents.map(r=>({id:r.id,body:r.visitor.rig?'blank':'classic',position:r.visitor.root.position.toArray(),role:session?.ids[0]===r.id?'initiator':session?.ids[1]===r.id?'recipient':'observer'}))};},
 };
}
