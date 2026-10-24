import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {furniturePalm} from './furnitureMotion';
import {sharedPalmTarget,type contactSolver,type HandSide} from './socialContact';
import {sampleSelected,type SelectedClip} from './selectedMotions';
import {contactEnvelope,type PairedHandProfile} from './motionContactProfiles';

type Participant={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
type Pair=readonly [HandSide,HandSide];
const pairs:readonly Pair[]=[['R','R'],['R','L'],['L','R'],['L','L']];
const sampledTimes=[.2,.35,.5,.65,.8] as const;
const pairCache=new WeakMap<SelectedClip,Pair>();

/**
 * Determine hand ownership from the source clip once, not from hands that
 * move under IK each frame (which can otherwise switch partners).
 */
export function sampledHandPair(clip:SelectedClip):Pair{
 const cached=pairCache.get(clip);
 if(cached)return cached;
 const scores=pairs.map(pair=>({
  pair,
  distance:sampledTimes.reduce((sum,t)=>{
   const a=sampleSelected(clip.actors[0],clip.duration*t);
   const b=sampleSelected(clip.actors[1],clip.duration*t);
   return sum+a.points[pair[0]+'_hand'].distanceTo(b.points[pair[1]+'_hand']);
  },0),
 }));
 const best=scores.sort((a,b)=>a.distance-b.distance)[0].pair;
 pairCache.set(clip,best);
 return best;
}
function palm(v:ChibiVisitor,side:HandSide){
 return v.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side));
}

/**
 * Shared target is measured BEFORE either IK solve, avoiding a chase loop.
 * Returns false for classic/no-IK bodies so their original fallback survives.
 */
export function applyPairedHandContact(
 profile:PairedHandProfile,
 clip:SelectedClip,
 both:readonly [Participant,Participant],
 weight:number,
 actionTime:number
){
 const [a,b]=both;
 if(!a.visitor.rig||!b.visitor.rig||!a.solver||!b.solver)return false;
 const strength=weight*contactEnvelope(profile,actionTime);
 if(strength<=0)return true;
 const [sideA,sideB]=sampledHandPair(clip);
 const target=sharedPalmTarget(palm(a.visitor,sideA),palm(b.visitor,sideB));
 for(const [resident,side] of [[a,sideA],[b,sideB]] as const){
  const rotation=resident.visitor.rig!.bones[side+'_hand'].getWorldQuaternion(new T.Quaternion());
  resident.solver!({
   side,
   point:target.clone(),
   direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(rotation),
   normal:new T.Vector3(0,1,0).applyQuaternion(rotation),
   curl:profile.curl,
  },strength);
 }
 return true;
}
