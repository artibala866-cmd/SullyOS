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

/** Only the embraced hold is longer; approach uses the ordinary scene navigation. */
export function rearHugPhase(time:number,shortActor:boolean){
 const t=clamp(Number.isFinite(time)?time:0,0,7.5);
 const enter=smooth(t,.20,.82);
 const wrap=smooth(t,.60,1.52)*(1-smooth(t,6.68,7.40));
 const close=smooth(t,1.30,1.90)*(1-smooth(t,6.55,7.15));
 const second=shortActor?smooth(t,3.05,3.36)*(1-smooth(t,3.56,3.86)):0;
 return {
  enter,wrap,close,second,
  head:smooth(t,1.54,1.95)*(1-smooth(t,6.54,7.18)),
  reply:smooth(t,1.83,2.32)*(1-smooth(t,6.74,7.43)),
  cover:smooth(t,2.05,2.46)*(1-smooth(t,6.78,7.48)),
  farewell:smooth(t,6.93,7.17)*(1-smooth(t,7.36,7.5)),
  release:smooth(t,6.70,7.5),
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
/** Three.js palm bone local -Y is the actual palm, +Y is its back.
 * Derive the OUTWARD normal from the recipient's waist ellipsoid. The solver
 * aligns the hand +Y to this normal so palm -Y faces into the body.
 * It must reverse for rear-flank targets: fixed +Z turned those into backhands.
 */
export function rearHugContact(recipient:ChibiVisitor,side:Side,point:T.Vector3,curl=.16):Contact{
 const chest=recipient.rig!.bones.chest;
 recipient.root.updateWorldMatrix(true,true);
 const local=chest.worldToLocal(point.clone());
 const outward=new T.Vector3(local.x/(.56*.56),(local.y+.10)/(.74*.74),local.z/(.40*.40)).normalize();
 const sign=side==='L'?1:-1;
 // Fingertips follow the flank tangent instead of pointing through the belly.
 const tangent=new T.Vector3(sign,0,0).addScaledVector(outward,-sign*outward.x);
 if(tangent.lengthSq()<.08)tangent.set(0,0,-Math.sign(outward.z||1));
 tangent.normalize();
 const q=chest.getWorldQuaternion(new T.Quaternion());
 return {side,point,direction:tangent.applyQuaternion(q),
  normal:outward.applyQuaternion(q),curl};
}

/** Use the existing house pathfinder first. Only if its returned route cuts
 * through B's CORE body, locally detour to either side. No fixed remote lap,
 * extra gait clip or A* pass on every frame.
 */
export function planRearHugApproach(
 start:T.Vector3,goal:T.Vector3,recipient:T.Vector3,orientation:T.Quaternion,
 find:(from:T.Vector3,to:T.Vector3)=>T.Vector3[]|null
):T.Vector3[]|null{
 const coreRadius=.32;
 const safe=(path:T.Vector3[]|null)=>{
  if(!path||path.length<2)return false;
  for(let i=1;i<path.length;i++){
   const p=path[i-1],q=path[i];
   const dx=q.x-p.x,dz=q.z-p.z,den=dx*dx+dz*dz;
   const t=den<1e-9?0:clamp(((recipient.x-p.x)*dx+(recipient.z-p.z)*dz)/den,0,1);
   if(Math.hypot(p.x+dx*t-recipient.x,p.z+dz*t-recipient.z)<coreRadius-1e-5)return false;
  }
  return true;
 };
 const direct=find(start,goal);
 if(safe(direct))return direct;
 const right=new T.Vector3(1,0,0).applyQuaternion(orientation).setY(0).normalize();
 const forward=new T.Vector3(0,0,1).applyQuaternion(orientation).setY(0).normalize();
 const candidates:T.Vector3[][]=[];
 // Tight core-sized waypoints, not the old ±.98 fixed-width procession.
 // Check three widths so an existing passage is not rejected for its size.
 for(const width of [.48,.58,.72])for(const sign of [-1,1]){
  const flank=recipient.clone().addScaledVector(right,sign*width);
  const checkpoints=[
   flank.clone().addScaledVector(forward,.48),
   flank.clone().addScaledVector(forward,-.43),
   goal,
  ];
  let from=start,path:T.Vector3[]=[start.clone()],ok=true;
  for(const point of checkpoints){
   const section=find(from,point);
   if(!safe(section)){ok=false;break;}
   path.push(...section!.slice(1));
   from=point;
  }
  if(ok)candidates.push(path);
 }
 if(!candidates.length)return null;
 const length=(path:T.Vector3[])=>path.slice(1).reduce((n,p,i)=>n+p.distanceTo(path[i]),0);
 candidates.sort((a,b)=>length(a)-length(b));
 return candidates[0];
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
  (-.14*p.head-.03*p.second)*strength,(cheek*p.head+.045*p.second)*strength));
 bBones.head.quaternion.multiply(quat(.045*p.reply*strength,
  (.20*p.reply+.21*p.farewell)*strength,-.045*p.reply*strength));
 actor.root.updateWorldMatrix(true,true);
 receiver.root.updateWorldMatrix(true,true);

 // All A palms are solved before B answers. A's R hand is laid slightly above
 // A's L; there is no compulsory hand-over-hand crossing for short chibi arms.
 for(const side of ['L','R'] as const){
  const sign=side==='L'?1:-1;
  aBones[side+'_clavicle'].quaternion.multiply(quat(0,0,-sign*.05*p.enter*strength));
  const upper=aBones[side+'_upperArm'];
  upper.quaternion.multiply(quat((-.10*p.enter-.04*p.second)*strength,-sign*.10*p.enter*strength,-sign*.07*p.second*strength));
  actor.root.updateWorldMatrix(true,true);
  const reach=armReach(actor,side);
  let goal=rearHugPalmTarget(receiver,side,side==='L');
  // Before asking the CCD solver to cross the torso, try the outer flank.
  const distance=reach.shoulder.distanceTo(goal);
  if(distance>reach.length*.95){
   const chest=bBones.chest,flank=chest.localToWorld(
    new T.Vector3(sign*.64,side==='L'?-.30:-.21,-.035));
   hugOutsideTarget(receiver,flank);
   if(reach.shoulder.distanceTo(flank)<distance)goal=flank;
  }
  if(p.second>.001){
   // Short A's second affectionate squeeze moves each palm a tiny distance
   // inward on the outside surface, never directly through the belly.
   const chest=bBones.chest;
   const local=chest.worldToLocal(goal.clone());
   local.x-=sign*.045*p.second;
   local.z+=.025*p.second;
   goal=chest.localToWorld(local);
   hugOutsideTarget(receiver,goal);
  }
  const deficit=Math.max(0,reach.shoulder.distanceTo(goal)-reach.length*.97);
  // When the waist is reachable, don't suppress IK and leave arms behind.
  // Beyond true bone length, preserve a nearby flank goal without wrenching joints.
  const reachWeight=clamp(1-Math.max(0,deficit-.035)/.28,.28,1);
  const hand=aBones[side+'_hand'].getWorldPosition(new T.Vector3());
  const target=hand.lerp(goal,p.wrap);
  if(p.wrap>.08)hugOutsideTarget(receiver,target);
  const contact=rearHugContact(receiver,side,target,.16);
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
  const contactReport=palmContactReport(actor,rearHugContact(receiver,'R',rearHugPalmTarget(receiver,'R'),.12));
  if(contactReport&&contactReport.error<.27)b.solver(handContact,strength*p.cover);
 }
 actor.root.updateWorldMatrix(true,true);
 receiver.root.updateWorldMatrix(true,true);
 return true;
}
