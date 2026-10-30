import {poseSeatedHug} from './seatedHug';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver} from './socialContact';
import {poseHug} from './hugMotion';
import {poseRearHug} from './rearHugMotion';
import {poseHandHoldPlead} from './handHoldPleadMotion';
import {poseSofaLapPillow} from './sofaLapPillowMotion';
import {posePrincessCarry,princessCarryPhase} from './princessCarryMotion';
import {lipWorld,aimLipContact} from './headContactIK';

type Resident={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
const smooth=T.MathUtils.smootherstep;
const rotation=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
export const isPrincessCarry=(id:string)=>id==='home-princess-carry'||id==='home-princess-carried';
export const isIntimacy=(id:string)=>id==='home-hug'||id==='home-rear-hug'||id==='home-hand-hold-plead'||id==='home-sofa-lap-pillow'||id==='home-kiss'||id==='home-sneak-kiss'||id==='home-passion-kiss'||isPrincessCarry(id);
/** Reference-video phases, in elapsed seconds; neither role owns a separate clock. */
export function intimacyPhase(action:string,time:number){
 const c=isPrincessCarry(action)?princessCarryPhase(time):null;
 return {contact:c?c.acquire*(1-c.release):smooth(time,.3,2)*(1-smooth(time,7.5,9.6)),
  lift:c?.lift??0,crouch:c?(c.stance+c.lower)*.4:0};

}
/** Pose only: called after idle reset; translations live under the navigation root. */
export function poseIntimacy(action:string,both:Resident[],time:number,seatedIndex?:number,handSign:1|-1=1){
 const [a,b]=both.map(r=>r.visitor),p=intimacyPhase(action,time);
 if(!a.rig||!b.rig)return;
 if(action==='home-hug'){if(seatedIndex===0||seatedIndex===1)poseSeatedHug(both,time,seatedIndex);else poseHug(both,time);return;}
 if(action==='home-rear-hug'){
  // Separate reviewed adapter: original facing hug is not suitable from behind.
  const fade=smooth(time,0,.35)*(1-smooth(time,6.95,7.5));
  poseRearHug(both as [Resident,Resident],time,fade);
  return;
 }
 if(action==='home-hand-hold-plead'){
  poseHandHoldPlead(both as [Resident,Resident],time,handSign);return;
 }
 if(action==='home-sofa-lap-pillow'){
  poseSofaLapPillow(both as [Resident,Resident],time);return;
 }
 if(action==='home-kiss'){
  // First meet eyes, then slowly align heads; maintain the kiss before easing away.
  const hands=smooth(time,1.65,3.1)*(1-smooth(time,10.5,12));
  const gaze=smooth(time,2.1,3.5)*(1-smooth(time,10.4,12));
  const kiss=smooth(time,4.2,5.4)*(1-smooth(time,9,10.7));
  const heads=both.map(r=>r.visitor.getHeadWorldPosition());
  // Aim the face at the partner instead of applying the same downward nod
  // to both residents. Height correction below happens before final aiming.
  // Adjust the kiss pose using the partners' actual head heights.
  // The shorter resident rises on their toes; the taller resident bends
  // slightly at the knees and waist. Both movements ease in and out.
  const heightBlend=smooth(time,3.45,5.15)*(1-smooth(time,9.1,11.25));
  if(heightBlend>0){
   const shorter=heads[0].y<=heads[1].y?a:b;
   const taller=shorter===a?b:a;
   const gap=Math.abs(heads[0].y-heads[1].y);
   // Avoid switching roles or lifting feet for almost equal-height partners.
   const difference=Math.max(0,gap-.035);
   const rise=T.MathUtils.clamp(difference*.32,0,.18)*heightBlend;
   const bend=T.MathUtils.clamp((difference-rise)*.55,0,.25)*heightBlend;
   // Take world-space stance snapshots before height blending alters the knees.
   const shorterSupport=captureLegSupport(shorter),tallerSupport=captureLegSupport(taller);
   for(const side of ['L','R'] as const){
    const foot=shorter.rig!.bones[side+'_foot'];
    const toe=shorter.rig!.bones[side+'_toe'];
    const base=foot.quaternion.clone();
    // Foot forward-axis differs between rigs; choose the direction that
    // raises the heel relative to the toe in world space.
    const angle=T.MathUtils.clamp(rise*1.8,0,.32);
    foot.quaternion.copy(base).multiply(rotation(angle));
    shorter.root.updateWorldMatrix(true,true);
    const plus=foot.getWorldPosition(new T.Vector3()).y-toe.getWorldPosition(new T.Vector3()).y;
    foot.quaternion.copy(base).multiply(rotation(-angle));
    shorter.root.updateWorldMatrix(true,true);
    const minus=foot.getWorldPosition(new T.Vector3()).y-toe.getWorldPosition(new T.Vector3()).y;
    foot.quaternion.copy(base).multiply(rotation(plus>=minus?angle:-angle));
    // The correction below keeps the toe on its original contact plane.
    taller.rig!.bones[side+'_thigh'].quaternion.multiply(rotation(-bend*1.8));
    taller.rig!.bones[side+'_shin'].quaternion.multiply(rotation(bend*3.1));
    taller.rig!.bones[side+'_foot'].quaternion.multiply(rotation(-bend*1.3));
   }
   // Toe targets must be sampled again after IK, not from the pre-IK cache.
   // Rising on the toes intentionally changes foot pitch.
   restoreLegSupport(shorter,shorterSupport,false);
   taller.rig!.bones.spine.quaternion.multiply(rotation(bend*.9));
   taller.rig!.bones.chest.quaternion.multiply(rotation(bend*1.05));
   taller.rig!.bones.neck.quaternion.multiply(rotation(bend*.45));
   // Keep the taller partner's world foot direction as knees fold.
   restoreLegSupport(taller,tallerSupport);
   a.root.updateWorldMatrix(true,true);
   b.root.updateWorldMatrix(true,true);
  }
  // For a height mismatch, the shorter partner lifts their chin and leans
  // slightly back, clearing the taller partner's fringe before lip aiming.
  // Apply around the local head X axis: negative X tilts the face upward
  // for this +Z-facing rig. Blend in and out with the height correction.
  if(heightBlend>0){
   const gap=Math.abs(heads[0].y-heads[1].y);
   const amount=T.MathUtils.clamp((gap-.035)*.65,0,.23)*heightBlend;
   if(amount>.0001){
    const shorter=heads[0].y<=heads[1].y?a:b;
    shorter.rig!.bones.neck.quaternion.multiply(rotation(-amount*.35));
    shorter.rig!.bones.head.quaternion.multiply(rotation(-amount*.65));
    shorter.root.updateWorldMatrix(true,true);
   }
  }
  // Re-evaluate approximate lip anchors after the height correction.
  // A shared midpoint is a target, not a forced head translation.
  const lipA=lipWorld(a),lipB=lipWorld(b);
  const shared=lipA.clone().add(lipB).multiplyScalar(.5);
  // Do not gate aiming by lip distance: that prevented distant faces from
  // ever acquiring the target. The root solver below handles the residual gap.
  const contactWeight=gaze;
  if(contactWeight>0){
   aimLipContact(a,shared,contactWeight);
   aimLipContact(b,shared,contactWeight);
  }
  // The head/neck can rotate but cannot translate the mouth all the way
  // to the partner. Close the remaining small gap with a bounded, symmetric
  // horizontal root correction; keep feet on their existing ground plane.
  if(kiss>.01){
   const mouthA=lipWorld(a),mouthB=lipWorld(b);
   const delta=mouthB.sub(mouthA);
   const horizontal=new T.Vector3(delta.x,0,delta.z);
   const distance=horizontal.length();
   if(distance>.001){
    const maxShift=.22*kiss;
    const shift=Math.min(Math.max(0,distance-.035)*.5,maxShift);
    const move=horizontal.multiplyScalar(shift/distance);
    a.root.position.add(move);
    b.root.position.sub(move);
    a.root.updateWorldMatrix(true,true);
    b.root.updateWorldMatrix(true,true);
   }
  }
  // Preserve the small opposite head tilts from the original kiss pose.
  a.rig.bones.head.quaternion.multiply(rotation(0,0,-.055*kiss));
  b.rig.bones.head.quaternion.multiply(rotation(0,0,.055*kiss));
  a.root.updateWorldMatrix(true,true);
  b.root.updateWorldMatrix(true,true);
  // Solve a shared hand contact after both heads have settled.
  const sides=['R','L'] as const;
  const handA=a.rig.bones.R_hand.getWorldPosition(new T.Vector3());
  const handB=b.rig.bones.L_hand.getWorldPosition(new T.Vector3());
  const target=handA.add(handB).multiplyScalar(.5);
  both.forEach((owner,i)=>{
   const side=sides[i],v=owner.visitor;
   owner.solver?.({side,point:target,direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(v.root.quaternion),normal:new T.Vector3(0,1,0),curl:.2},hands);
  });
  return;
 }

 return posePrincessCarry(both,time);
}
