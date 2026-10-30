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
  // No synchronized squat: offer one knee with the opposite foot grounded.
  stance:e(3.25,3.90,4.30,5.30), acquire:smooth(t,.65,2.4),
  secured:e(2.65,3.55,9.15,9.85), weight:e(3.85,4.55,8.0,9.15),
  offer:e(2.6,3.55,7.35,8.9),
  seat:e(3.88,5.15,7.15,9.1),
  cradle:e(4.05,5.42,7.1,9.0), tuck:e(4.1,5.2,7.25,8.9),
  lift:e(3.88,5.25,6.8,9.0), lower:e(6.7,7.75,8.95,9.8),
  plant:smooth(t,8.55,9.08), embrace:e(1.85,3.2,8.95,9.6),
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
 // Reach beneath the OFFERED knee, not the shin of the still-planted
 // leg. Otherwise the carrier's hand reaches toward the floor and the
 // recipient appears to squat to meet it.
 const knee=b.L_shin.getWorldPosition(new T.Vector3());
 const thigh=b.L_thigh.getWorldPosition(new T.Vector3());
 const lower=knee.clone().lerp(thigh,.20).add(new T.Vector3(0,-.045,0));
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
 // Estimate the combined horizontal centre of mass from both torso
 // proportions and the planned cradle pelvis. Compare its floor projection to
 // the real support-toe footprint, not a hardcoded pose displacement.
 a.root.updateWorldMatrix(true,true);
 const carrierHip=point(a,'hips'),carrierChest=point(a,'chest');
 const frontLoad=new T.Vector3(0,0,1).applyQuaternion(ab.hips.getWorldQuaternion(new T.Quaternion())).normalize();
 const shoulderWidth=point(a,'L_upperArm').distanceTo(point(a,'R_upperArm'));
 const estimatedLoad=carrierChest.clone().addScaledVector(frontLoad,shoulderWidth*.95);
 const footCentre=feetA!.toes[0].clone().add(feetA!.toes[1]).multiplyScalar(.5);
 const massShare=T.MathUtils.clamp(Math.pow(ratio,3)/(1+Math.pow(ratio,3)),.32,.68);
 const combined=carrierHip.clone().lerp(estimatedLoad,massShare);
 const toeForward=Math.max(...feetA!.toes.map(toe=>toe.clone().sub(footCentre).dot(frontLoad)));
 const overhang=Math.max(0,combined.sub(footCentre).dot(frontLoad)-toeForward);
 const torsoLength=carrierChest.distanceTo(carrierHip);
 const counterTilt=T.MathUtils.clamp(.028+Math.atan2(overhang,Math.max(.01,torsoLength))*.5,.028,.17)*p.weight;
 // Mild height-aware leg flex by the carrier, never a deep squat.
 const reachBend=.035+.10*Math.max(0,ratio-.9);
 const flex=reachBend*p.stance+.075*p.lower+
  p.weight*T.MathUtils.clamp(.04*ratio+counterTilt*.23,.035,.085);
 // Support legs flex first; the spine leans against the measured forward
 // overhang while the chest preserves a stable surface for both support palms.
 for(const side of ['L','R'] as const){
  const sign=side==='L'?-1:1;
  pose(a,side+'_thigh',q(-flex,0,sign*.05*p.acquire),1);
  pose(a,side+'_shin',q(flex*1.95),1);
  pose(a,side+'_foot',q(-flex*.95),1);
 }
 ab.spine.quaternion.multiply(q(-counterTilt));
 ab.chest.quaternion.multiply(q(counterTilt*.35));
 a.root.updateWorldMatrix(true,true);
 restoreLegSupport(a,feetA);
 const floor=a.root.getWorldPosition(new T.Vector3()).y+.012;
 const sole=Math.min(...['L_foot','R_foot','L_toe','R_toe'].map(n=>point(a,n).y));
 if(sole<floor)a.translatePose(new T.Vector3(0,Math.min(.75,floor-sole),0));
 // One offered knee first, then a supported lift/recline. Neither person's
 // pelvis rotates while the standing foot carries their body weight.
 const seated=p.seat,lifted=p.lift;
 const sideTurn=.36*seated+1.17*p.cradle;
 const heightRecline=T.MathUtils.clamp((ratio-1)*.70,0,.25);
 const recline=.08*seated+(.73+heightRecline)*p.cradle;
 const cradleWeight=Math.max(seated,p.cradle);
 pose(b,'hips',q(0,sideTurn).multiply(q(-recline)),cradleWeight);
 // The back does not follow the pelvis as one stiff board: it stays upright
 // during initial seating and gently yields as weight transfers to the arms.
 bb.spine.quaternion.multiply(q(.24*p.cradle));
 bb.chest.quaternion.multiply(q(.14*p.cradle));
 const legs=[
  {side:'L' as const, fold:p.offer}, // offered knee, while R sole bears weight
  {side:'R' as const, fold:smooth(time,4.17,5.18)*(1-smooth(time,7.45,9.05))}, // planted until takeoff
 ];
 for(const {side,fold} of legs){
  const sign=side==='L'?-1:1;
  pose(b,side+'_thigh',q(-1.32,0,sign*.035),fold);
  pose(b,side+'_shin',q(1.45),fold);
  pose(b,side+'_foot',q(.12),fold);
 }
 // A seated person's neck remains free to track the carrier instead of
 // snapping to the body tilt; the shoulder embrace follows the actual lift.
 bb.neck.quaternion.multiply(q(-.035*p.cradle));
 bb.head.quaternion.multiply(q(-.055*p.cradle));
 b.root.updateWorldMatrix(true,true);
 // The recipient may turn and bend before takeoff, but cannot float upward
 // from the floor merely because the pelvis is being rotated.
 // Do not switch off foot IK on the first non-zero lift frame. That Boolean
 // crossing made the pelvis jump 7 cm in one 60Hz frame. Transfer the
 // recipient's weight from planted feet into the two cradle hands gradually.
 // Lock just the R standing sole; locking the offered L foot makes both
 // knees squat. Hand off this sole to the cradle over multiple 60Hz frames.
 const groundShare=(1-smooth(time,3.86,4.33))*(1-p.release);
 if(groundShare>0)restoreLegSupport(b,feetB,true,.14,groundShare,'R');
 // Rebuild the loaded pelvis destination from actual carrier skeleton lengths.
 const hip=point(a,'hips'),chest=point(a,'chest');
 const left=point(a,'L_upperArm'),right=point(a,'R_upperArm');
 const width=left.distanceTo(right);
 const front=new T.Vector3(0,0,1).applyQuaternion(ab.hips.getWorldQuaternion(new T.Quaternion())).normalize();
 const across=right.clone().sub(left).normalize();
 // The carrier's palms support a seated pelvis below their chest, not a
 // shoulder-high pelvis. Keeping the torso upright without this lower cradle
 // buried the recipient's oversized Q head in the carrier's hair.
 const seatDrop=width*(.70+Math.max(0,ratio-1)*.18);
 const target=hip.lerp(chest,.76).addScaledVector(front,width*.95)
  // The Q-rig's bone right-left axis points toward negative world X in
  // this carrier-facing arrangement: extend the seated body OUTWARD, not
  // into the carrier's oversized head (verified against front/side WebGL).
  .addScaledVector(across,-width*.70).add(new T.Vector3(0,-seatDrop,0));
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
 // Blend foot-ground reconciliation in gradually instead of crossing a
 // boolean IK threshold at ~8.6s; a hard switch snaps the carried pelvis.
 // The shared resolver stays unchanged for all full-strength callers.
 if(p.plant>0&&p.lift<.10)restoreLegSupport(b,feetB,true,.16,p.plant);
 return true;
}
