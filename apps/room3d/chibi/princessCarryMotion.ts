import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver} from './socialContact';
import {captureLegSupport,restoreLegSupport} from './legContactIK';

type Member={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
const smooth=T.MathUtils.smootherstep;
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
const point=(v:ChibiVisitor,n:string,offset=new T.Vector3())=>v.rig!.bones[n].localToWorld(offset.clone());
const pose=(v:ChibiVisitor,n:string,value:T.Quaternion,w:number)=>v.rig!.bones[n].quaternion.slerp(value,T.MathUtils.clamp(w,0,1));

/** Single deterministic pair clock: support before lifting, feet before release. */
export function princessCarryPhase(time:number){
 const t=T.MathUtils.clamp(Number.isFinite(time)?time:0,0,10);
 const e=(a:number,b:number,c:number,d:number)=>smooth(t,a,b)*(1-smooth(t,c,d));
 return {
  stance:e(.35,1.55,2.95,4.35), acquire:smooth(t,.65,2.4),
  secured:e(2.1,2.8,9.15,9.85), weight:e(2.75,3.45,8.35,9.1),
  cradle:e(2.85,4.3,6.9,8.65), tuck:e(3.1,4.35,7.1,8.65),
  lift:e(3.25,4.75,6.75,8.95), lower:e(6.55,7.60,8.9,9.8),
  plant:smooth(t,8.55,9.08), embrace:e(3.9,5.15,8.95,9.6),
  release:smooth(t,9.15,9.85),
 };
}
/** Anatomical proportions preflight, independent of initial room distance. */
export function assessPrincessCarryReach(carrier:ChibiVisitor,recipient:ChibiVisitor){
 if(!carrier.rig||!recipient.rig)return {possible:false,ratio:Infinity};
 const a=carrier.rig.bones,b=recipient.rig.bones;
 carrier.root.updateWorldMatrix(true,true);recipient.root.updateWorldMatrix(true,true);
 const torso=(bones:typeof a)=>bones.chest.getWorldPosition(new T.Vector3())
  .distanceTo(bones.hips.getWorldPosition(new T.Vector3()));
 const ratio=torso(b)/Math.max(.001,torso(a));
 const arm=(side:'L'|'R')=>a[side+'_upperArm'].getWorldPosition(new T.Vector3())
  .distanceTo(a[side+'_forearm'].getWorldPosition(new T.Vector3()))+
  a[side+'_forearm'].getWorldPosition(new T.Vector3())
  .distanceTo(a[side+'_hand'].getWorldPosition(new T.Vector3()));
 const span=b.spine.getWorldPosition(new T.Vector3())
  .distanceTo(b.R_shin.getWorldPosition(new T.Vector3()));
 return {possible:Number.isFinite(ratio)&&ratio<=1.90&&span<=2.9*Math.min(arm('L'),arm('R')),ratio};
}
/** Skin-side contact frame recalculated after recipient pose each frame. */
export function princessCarrySupports(v:ChibiVisitor){
 const b=v.rig!.bones;v.root.updateWorldMatrix(true,true);
 const upper=b.spine.localToWorld(new T.Vector3(0,.10,-.16));
 const knee=b.R_shin.getWorldPosition(new T.Vector3());
 const lower=b.R_shin.localToWorld(new T.Vector3(0,.08,-.10))
  .addScaledVector(b.R_thigh.getWorldPosition(new T.Vector3()).sub(knee),.08);
 return {upper,lower};
}

/** Pair-specific skeletal blocking within the existing player and arm IK. */
export function posePrincessCarry(pair:readonly Member[],time:number){
 const a=pair[0]?.visitor,b=pair[1]?.visitor;
 if(!a?.rig||!b?.rig)return false;
 const p=princessCarryPhase(time),ab=a.rig.bones,bb=b.rig.bones;
 const feetA=captureLegSupport(a),feetB=captureLegSupport(b);
 const ratio=T.MathUtils.clamp(point(b,'chest').distanceTo(point(b,'hips'))/
  Math.max(.01,point(a,'chest').distanceTo(point(a,'hips'))),.7,1.35);
 const flex=(p.stance+p.lower)*.40+p.weight*.08*ratio;
 // Load originates in the supporting legs and is counterbalanced by the spine.
 for(const side of ['L','R'] as const){
  const sign=side==='L'?-1:1;
  pose(a,side+'_thigh',q(-flex,0,sign*.05*p.acquire),1);
  pose(a,side+'_shin',q(flex*1.95),1);
  pose(a,side+'_foot',q(-flex*.95),1);
 }
 ab.spine.quaternion.multiply(q(-.07*p.weight*ratio));
 ab.chest.quaternion.multiply(q(.04*p.weight*ratio));
 a.root.updateWorldMatrix(true,true);
 restoreLegSupport(a,feetA);
 const floor=a.root.getWorldPosition(new T.Vector3()).y+.012;
 const sole=Math.min(...['L_foot','R_foot','L_toe','R_toe'].map(n=>point(a,n).y));
 if(sole<floor)a.translatePose(new T.Vector3(0,Math.min(.40,floor-sole),0));
 // A gradual pelvis turn and leg tuck are independent from the vertical lift.
 const recline=1.04+T.MathUtils.clamp((ratio-1)*.70,0,.22);
 pose(b,'hips',q(0,Math.PI/2).multiply(q(-recline)),p.cradle);
 for(const side of ['L','R'] as const){
  pose(b,side+'_thigh',q(-1.35,0,side==='L'?-.025:.025),p.tuck);
  pose(b,side+'_shin',q(1.45),p.tuck);
  pose(b,side+'_foot',q(.12),p.tuck);
 }
 const headDelay=p.cradle-smooth(time,3.25,4.70)*(1-smooth(time,7.35,8.85));
 bb.neck.quaternion.multiply(q(-.05*headDelay));
 bb.head.quaternion.multiply(q(-.08*headDelay));
 b.root.updateWorldMatrix(true,true);
 // Rebuild the loaded pelvis destination from actual carrier skeleton lengths.
 const hip=point(a,'hips'),chest=point(a,'chest');
 const left=point(a,'L_upperArm'),right=point(a,'R_upperArm');
 const width=left.distanceTo(right);
 const front=new T.Vector3(0,0,1).applyQuaternion(ab.hips.getWorldQuaternion(new T.Quaternion())).normalize();
 const across=right.clone().sub(left).normalize();
 const target=hip.lerp(chest,.80).addScaledVector(front,width*.95).addScaledVector(across,width*.18);
 b.translatePose(target.sub(point(b,'hips')).multiplyScalar(p.lift));
 b.root.updateWorldMatrix(true,true);
 // Keep both support targets in reach without stretching bone lengths.
 for(let k=0;k<3&&p.lift>.001;k++){
  const support=princessCarrySupports(b),goals=[support.upper,support.lower];
  const adjustment=new T.Vector3();let count=0;
  for(const [i,side] of (['L','R'] as const).entries()){
   const shoulder=point(a,side+'_upperArm'),elbow=point(a,side+'_forearm'),wrist=point(a,side+'_hand');
   const length=(shoulder.distanceTo(elbow)+elbow.distanceTo(wrist))*.96;
   const ray=goals[i].clone().sub(shoulder),distance=ray.length();
   if(distance>length&&distance>1e-6){adjustment.addScaledVector(ray,(length-distance)/distance);count++;}
  }
  if(!count)break;
  adjustment.multiplyScalar(p.lift/count).clampLength(0,.07);
  if(adjustment.lengthSq()<1e-8)break;
  b.translatePose(adjustment);b.root.updateWorldMatrix(true,true);
 }
 // Approach both contact points through outward arcs, not torso-crossing chords.
 const rotation=a.root.getWorldQuaternion(new T.Quaternion()),access=smooth(time,.95,2.70);
 const support=princessCarrySupports(b);
 for(const [side,anchor] of [['L',support.upper],['R',support.lower]] as const){
  const sign=side==='L'?1:-1;
  ab[side+'_clavicle'].quaternion.multiply(q(0,sign*.12*p.acquire,sign*.06*p.acquire));
  pose(a,side+'_upperArm',q(-.2,side==='L'?-.6:.6,side==='L'?-.7:.7),p.acquire);
  pose(a,side+'_forearm',q(-.22,sign*.13,-sign*.16),p.acquire);
  a.root.updateWorldMatrix(true,true);
  const outward=new T.Vector3(sign,0,0).applyQuaternion(rotation);
  const waypoint=point(a,side+'_upperArm').addScaledVector(outward,width*.42)
   .addScaledVector(front,width*.22).add(new T.Vector3(0,-width*.15,0));
  const goal=waypoint.lerp(anchor,access)
   .addScaledVector(outward,Math.sin(Math.PI*access)*width*.22);
  pair[0].solver?.({side,point:goal,
   direction:new T.Vector3(sign,0,0).applyQuaternion(rotation),
   normal:new T.Vector3(0,1,0).applyQuaternion(rotation),
   curl:.28*p.secured},p.acquire*(1-p.release));
 }
 // Shoulder embrace follows successful load, never initiates the lift.
 for(const side of ['L','R'] as const){
  const sign=side==='L'?-1:1;
  bb[side+'_clavicle'].quaternion.multiply(q(0,sign*.10*p.embrace));
  pose(b,side+'_upperArm',q(-.25,sign*.58,sign*.58),p.embrace);
  pose(b,side+'_forearm',q(-.30,sign*.2,-sign*.13),p.embrace);
 }
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
 for(const [side,anchor] of [
  ['L',ab.R_upperArm.localToWorld(new T.Vector3(0,.07,-.10))],
  ['R',ab.L_upperArm.localToWorld(new T.Vector3(0,.02,-.12))],
 ] as const)pair[1].solver?.({side,point:anchor,
  direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(rotation),
  normal:new T.Vector3(0,1,0).applyQuaternion(rotation),
  curl:.14*p.embrace},p.embrace);
 // Feet settle before both partners release their hands after 9.15 seconds.
 if(p.plant>.01&&p.lift<.10)restoreLegSupport(b,feetB);
 return true;
}
