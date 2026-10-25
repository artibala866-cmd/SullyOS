import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver,Contact} from './socialContact';
import {palmContactReport} from './socialContact';
import {furniturePalm} from './furnitureMotion';
import {hugOutsideTarget,keepHugArmOutside} from './hugArmClearance';
import {poseHugFingers} from './hugHands';
import {applyStandingHeightAdaptation} from './standingHeightAdaptation';

type Resident={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
type Side='L'|'R';
const smooth=T.MathUtils.smootherstep;
const clamp=T.MathUtils.clamp;
const quat=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));

/** Five-second, shared-clock action; walk-in time is handled by selectedSocial. */
export function rearHugPhase(time:number,shortActor:boolean){
 const t=clamp(Number.isFinite(time)?time:0,0,5);
 const enter=smooth(t,.20,.82);
 const wrap=smooth(t,.60,1.52)*(1-smooth(t,4.18,4.90));
 const close=smooth(t,1.30,1.90)*(1-smooth(t,4.05,4.65));
 const second=shortActor?smooth(t,3.05,3.36)*(1-smooth(t,3.56,3.86)):0;
 return {
  enter,wrap,close,second,
  head:smooth(t,1.54,1.95)*(1-smooth(t,4.04,4.68)),
  reply:smooth(t,1.83,2.32)*(1-smooth(t,4.24,4.93)),
  cover:smooth(t,2.05,2.46)*(1-smooth(t,4.28,4.98)),
  release:smooth(t,4.20,5),
 };
}

/** Symmetric hand lanes on the recipient's *front flanks*, never through the chest.
 * The existing hug ellipse uses chest-local units and accounts for root scale.
 */
export function rearHugPalmTarget(recipient:ChibiVisitor,side:Side,low=false){
 const sign=side==='L'?1:-1;
 recipient.root.updateWorldMatrix(true,true);
 const chest=recipient.rig!.bones.chest;
 const front=chest.localToWorld(new T.Vector3(sign*.48,low?-.30:-.21,.22));
 return hugOutsideTarget(recipient,front);
}
function armReach(v:ChibiVisitor,side:Side){
 const b=v.rig!.bones;
 const a=b[side+'_upperArm'].getWorldPosition(new T.Vector3());
 const e=b[side+'_forearm'].getWorldPosition(new T.Vector3());
 const w=b[side+'_hand'].getWorldPosition(new T.Vector3());
 return {shoulder:a,length:a.distanceTo(e)+e.distanceTo(w)};
}
function contactFor(v:ChibiVisitor,side:Side,point:T.Vector3,curl:number):Contact{
 const q=v.rig!.bones.chest.getWorldQuaternion(new T.Quaternion());
 const sign=side==='L'?1:-1;
 // The local -Y face is the palm: +Z normal turns it inward into the waist.
 return {side,point,direction:new T.Vector3(sign,0,0).applyQuaternion(q),
  normal:new T.Vector3(0,0,1).applyQuaternion(q),curl};
}

/** Only operates on the currently playing pair; keeps both feet/nav roots untouched. */
export function poseRearHug(both:readonly [Resident,Resident],time:number,weight=1){
 const [a,b]=both;
 if(!a.visitor.rig||!b.visitor.rig)return false;
 const actor=a.visitor,receiver=b.visitor,strength=clamp(weight,0,1);
 if(strength<=0)return false;
 actor.root.updateWorldMatrix(true,true);
 receiver.root.updateWorldMatrix(true,true);
 const aCrown=actor.getHeadTopWorldPosition().y;
 const bCrown=receiver.getHeadTopWorldPosition().y;
 const shortActor=aCrown+.08<bCrown;
 const tallActor=aCrown>bCrown+.12;
 const p=rearHugPhase(time,shortActor);

 // Reuse the existing knee/foot-grounding correction when the GIVER is taller.
 // A short giver reaches the taller receiver's waist; no forced receiver crouch.
 if(tallActor)applyStandingHeightAdaptation([actor,receiver],
  {mode:'contact',weight:strength*p.close*.72});

 const aBones=actor.rig.bones,bBones=receiver.rig.bones;
 aBones.spine.quaternion.multiply(quat(.085*p.close*strength,0,0));
 aBones.chest.quaternion.multiply(quat((.09*p.close+.012*p.second)*strength,0,0));
 bBones.spine.quaternion.multiply(quat(-.027*p.reply*strength,0,0));
 bBones.chest.quaternion.multiply(quat(-.034*p.reply*strength,0,0));

 // Large, almost neckless heads: only gentle nod/yaw, never a 180-degree turn.
 const cheek=shortActor?.16:.11;
 aBones.head.quaternion.multiply(quat((shortActor?-.11:.12)*p.head*strength,
  -.14*p.head*strength,cheek*p.head*strength));
 bBones.head.quaternion.multiply(quat(.045*p.reply*strength,
  .20*p.reply*strength,-.045*p.reply*strength));
 actor.root.updateWorldMatrix(true,true);
 receiver.root.updateWorldMatrix(true,true);

 // All A palms are solved before B answers. A's R hand is laid slightly above
 // A's L; there is no compulsory hand-over-hand crossing for short chibi arms.
 for(const side of ['L','R'] as const){
  const sign=side==='L'?1:-1;
  aBones[side+'_clavicle'].quaternion.multiply(quat(0,0,-sign*.05*p.enter*strength));
  const upper=aBones[side+'_upperArm'];
  upper.quaternion.multiply(quat(-.10*p.enter*strength,-sign*.10*p.enter*strength,0));
  actor.root.updateWorldMatrix(true,true);
  const reach=armReach(actor,side);
  let goal=rearHugPalmTarget(receiver,side,side==='L');
  // Before asking the CCD solver to cross the torso, try the outer flank.
  const distance=reach.shoulder.distanceTo(goal);
  if(distance>reach.length*.97){
   const chest=bBones.chest,flank=chest.localToWorld(
    new T.Vector3(sign*.64,side==='L'?-.30:-.21,-.035));
   hugOutsideTarget(receiver,flank);
   if(reach.shoulder.distanceTo(flank)<distance)goal=flank;
  }
  const deficit=Math.max(0,reach.shoulder.distanceTo(goal)-reach.length*.97);
  const reachWeight=clamp(1-deficit/.34,.10,1);
  const hand=aBones[side+'_hand'].getWorldPosition(new T.Vector3());
  const target=hand.lerp(goal,p.wrap);
  if(p.wrap>.08)hugOutsideTarget(receiver,target);
  const contact=contactFor(receiver,side,target,.16);
  const influence=strength*p.enter*p.wrap*reachWeight;
  a.solver?.(contact,influence);
  if(a.solver&&influence>.2)keepHugArmOutside(actor,receiver,contact,influence);
  poseHugFingers(actor.rig,side,time,0,strength*p.enter,p.wrap,0);
  actor.root.updateWorldMatrix(true,true);
 }

 // B covers an *actual* A palm, never an imaginary target if A's arm is short.
 // This is intentionally delayed: B reacts after the first gentle squeeze.
 if(b.solver&&p.cover>.002){
  const from=aBones.R_hand.localToWorld(furniturePalm('R'));
  const q=bBones.chest.getWorldQuaternion(new T.Quaternion());
  const handContact:Contact={side:'R',point:from,
   direction:new T.Vector3(1,0,0).applyQuaternion(q),
   normal:new T.Vector3(0,0,1).applyQuaternion(q),curl:.13};
  if(palmContactReport(actor,contactFor(receiver,'R',rearHugPalmTarget(receiver,'R'),.12))?.error!<.27)
   b.solver(handContact,strength*p.cover);
 }
 actor.root.updateWorldMatrix(true,true);
 receiver.root.updateWorldMatrix(true,true);
 return true;
}
