import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver,Contact} from './socialContact';
import {furniturePalm,furnitureHandRotation} from './furnitureMotion';
import {headPatScalpSize} from './headPatMotion';

type Resident={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
const smooth=T.MathUtils.smootherstep;
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
const clamp=T.MathUtils.clamp;
const fade=(t:number,on:number,full:number,off:number,end:number)=>
 smooth(t,on,full)*(1-smooth(t,off,end));

/** Nine-point-three seconds after BOTH visitors are on two seats of one sofa.
 * A pillows B's thigh, B supports then strokes the scalp. No root path/teleport.
 */
export const SOFA_LAP_PILLOW_SECONDS=9.3;
export function sofaLapPillowPhase(t:number){
 const time=clamp(t,0,SOFA_LAP_PILLOW_SECONDS);
 // Move the seat contact BEFORE loading the arms. Only then lower the torso.
 const brace=fade(time,.25,1.40,3.05,3.65)+fade(time,6.35,7.10,8.35,9.30);
 const scoot=fade(time,.12,1.35,8.30,9.30);
 const turn=fade(time,1.05,2.00,8.05,8.85);
 const lower=fade(time,1.45,3.15,7.35,8.45);
 const settle=fade(time,2.30,3.45,7.05,7.75);
 const headLift=smooth(time,7.05,7.75);
 const support=fade(time,1.50,2.65,3.35,3.85);
 const stroke=fade(time,3.35,3.85,6.35,6.85);
 const first=fade(time,3.85,4.45,4.45,5.00);
 const second=fade(time,5.10,5.85,5.85,6.40);
 const rise=smooth(time,7.05,9.30);
 return {
  lower,brace:clamp(brace,0,1),scoot,turn,settle,headLift,
  support,stroke,first,second,rise,
  cheek:fade(time,4.66,5.07,5.20,5.70),
  eye:fade(time,1.30,2.78,8.35,9.28)
 };
}

export function lapPillowSide(a:ChibiVisitor,b:ChibiVisitor):1|-1{
 const right=new T.Vector3(1,0,0).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
 return b.root.getWorldPosition(new T.Vector3()).sub(a.root.getWorldPosition(new T.Vector3())).dot(right)>=0?1:-1;
}

/** Anchor is measured from the actual B thigh, not a fixed standing head Y.
 * The rotated scalp proxy stays above the scaled thigh surface.
 * Clothing and individual hairstyles still require visual clearance checks.
 */
export function lapPillowHeadTarget(a:ChibiVisitor,b:ChibiVisitor):T.Vector3{
 const side=lapPillowSide(b,a);
 const nearest=side>0?'L':'R';
 const thigh=b.rig!.bones[nearest+'_thigh'];
 const shin=b.rig!.bones[nearest+'_shin'];
 b.root.updateWorldMatrix(true,true);
 const top=thigh.getWorldPosition(new T.Vector3());
 const knee=shin.getWorldPosition(new T.Vector3());
 const point=top.lerp(knee,.27);
 const size=headPatScalpSize(a);
 // Support the rotated ellipsoid, not an upright radius times a magic fraction.
 const rotation=a.rig!.bones.head.getWorldQuaternion(new T.Quaternion());
 const vertical=new T.Vector3(0,1,0).applyQuaternion(rotation.invert());
 const radius=Math.hypot(vertical.x*size.radius,vertical.y*size.height,vertical.z*size.depth);
 const up=new T.Vector3(0,1,0);
 // The thigh is an upper-leg anchor, not a scalp support plane.
 point.addScaledVector(up,radius+.16*b.rig!.bones.hips.getWorldScale(new T.Vector3()).y);
 return point;
}

/** One contact normal per frame; hand local -Y is the palm and must face
 * inward against the scalp. Use a tangent to prevent a folded wrist.
 */
export function lapPillowHeadContact(
 b:ChibiVisitor,a:ChibiVisitor,side:'L'|'R',towardForehead:number,supporting=0
):Contact{
 const head=a.rig!.bones.head,rotation=head.getWorldQuaternion(new T.Quaternion());
 const up=new T.Vector3(0,1,0).applyQuaternion(rotation);
 const front=new T.Vector3(0,0,1).applyQuaternion(rotation);
 const size=headPatScalpSize(a);
 // A real crown-to-side-forehead pass. Previous .18*depth travel was only
 // a few centimetres, essentially a stationary hand. Project the stroke on
 // the chibi's curved hair cap, and align the near-side with B's shoulder.
 const across=new T.Vector3(1,0,0).applyQuaternion(rotation);
 // Use the fixed sofa side. A shoulder projection crosses the head's local
 // X plane during descent and used to switch both contact and wrist by 180°.
 const sideSign=lapPillowSide(a,b);
 const travel=clamp(towardForehead,0,1);
 const x=sideSign*size.radius*(.13+.28*travel);
 const z=size.depth*(.07+.40*travel);
 const y=size.height*Math.sqrt(Math.max(.20,1-(x/size.radius)**2-(z/size.depth)**2));
 const normal=across.clone().multiplyScalar(x/(size.radius*size.radius))
  .addScaledVector(front,z/(size.depth*size.depth))
  .addScaledVector(up,y/(size.height*size.height)).normalize();
 const center=a.getHeadWorldPosition();
 const point=center.clone().addScaledVector(up,y)
  .addScaledVector(front,z).addScaledVector(across,x);
 // During descent B's palm supports the OCCIPUT, not the forehead/crown.
 // Blend smoothly to the scalp stroke as the head settles on the leg.
 const handBack=front.clone().negate();
 const backContact=center.addScaledVector(handBack,size.depth*.78).addScaledVector(up,size.height*.10);
 const backNormal=handBack.multiplyScalar(1.15).addScaledVector(up,.15).normalize();
 const hold=clamp(supporting,0,1);
 point.lerp(backContact,hold);
 normal.lerp(backNormal,hold).normalize();
 // Across the skull stays transverse to both the occiput and crown normal.
 // Blending front/up became parallel to the normal halfway through transfer
 // and flipped the wrist tangent by 180 degrees.
 const tangent=across.clone().multiplyScalar(-sideSign);
 const direction=tangent.addScaledVector(normal,-tangent.dot(normal));
 if(direction.lengthSq()<1e-7)direction.crossVectors(normal,new T.Vector3(1,0,0));
 direction.normalize();
 return {side,point,direction,normal,curl:.18};
}

/** Blend the PALM in world space, then solve at full weight. Blending arm
 * joints and wrist orientation independently made the releasing hand snap
 * through a different wrist rotation while the elbow was still reaching.
 */
function solveLapHand(resident:Resident,contact:Contact,weight:number){
 if(!resident.solver||weight<=0)return;
 const hand=resident.visitor.rig!.bones[contact.side+'_hand'];
 resident.visitor.root.updateWorldMatrix(true,true);
 const rotation=hand.getWorldQuaternion(new T.Quaternion()).slerp(
  furnitureHandRotation(contact.side,contact.direction.toArray(),contact.normal.toArray()),weight);
 const point=hand.localToWorld(furniturePalm(contact.side)).lerp(contact.point,weight);
 resident.solver({...contact,point,
  direction:new T.Vector3(contact.side==='L'?1:-1,0,0).applyQuaternion(rotation),
  normal:new T.Vector3(0,1,0).applyQuaternion(rotation),
 },1);
}

type LapPlan={partner:ChibiVisitor;angle:number;slide:T.Vector3;seatY:number};
const plans=new WeakMap<ChibiVisitor,LapPlan>();

/** Work out the lying endpoint from the actual seated skeleton BEFORE moving.
 * Restore every trial rotation; neither navigation roots nor bone lengths move.
 * Vertical contact is achieved by reclining, never by dragging hips downwards.
 */
function planLap(a:ChibiVisitor,b:ChibiVisitor,sign:number):LapPlan{
 const bones=a.rig!.bones;
 const saved=['hips','spine','chest'].map(n=>bones[n].quaternion.clone());
 const trial=(angle:number)=>{
  bones.hips.quaternion.copy(saved[0]).multiply(q(0,sign*.28,-sign*.20));
  bones.spine.quaternion.copy(saved[1]).multiply(q(.06,sign*.10,-sign*angle*.60));
  bones.chest.quaternion.copy(saved[2]).multiply(q(-.06,-sign*.06,-sign*angle*.40));
  a.root.updateWorldMatrix(true,true);
  return a.getHeadWorldPosition().y-lapPillowHeadTarget(a,b).y;
 };
 let lo=0,hi=1.65;
 for(let i=0;i<14;i++){const mid=(lo+hi)/2;if(trial(mid)>0)lo=mid;else hi=mid;}
 const angle=(lo+hi)/2;trial(angle);
 const slide=lapPillowHeadTarget(a,b).sub(a.getHeadWorldPosition());slide.y=0;
 ['hips','spine','chest'].forEach((n,i)=>bones[n].quaternion.copy(saved[i]));
 a.root.updateWorldMatrix(true,true);
 return {partner:b,angle,slide,seatY:a.root.getWorldPosition(new T.Vector3()).y+a.seatOffset};
}

/** Seated scoot -> lifted hands -> supported waist turn -> head transfer.
 * Endpoint planning replaces the old late, clamped whole-body head chase.
 */
export function poseSofaLapPillow(both:readonly [Resident,Resident],time:number){
 const [aResident,bResident]=both;
 const a=aResident?.visitor,b=bResident?.visitor;
 if(!a?.rig||!b?.rig)return false;
 const p=sofaLapPillowPhase(time),sign=lapPillowSide(a,b);
 const ar=a.rig.bones,br=b.rig.bones;
 let plan=plans.get(a);
 if(!plan||plan.partner!==b||time===0){plan=planLap(a,b,sign);plans.set(a,plan);}
 const scale=ar.hips.getWorldScale(new T.Vector3()).y;
 const right=new T.Vector3(1,0,0).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
 const forward=new T.Vector3(0,0,1).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
 const initialHip=ar.hips.getWorldPosition(new T.Vector3());
 // The planned shift may be AWAY from B on narrow seats: make room for the
 // large head and short torso rather than always pushing .36 toward B.
 a.translatePose(plan.slide.clone().multiplyScalar(p.scoot));
 ar.hips.quaternion.multiply(q(0,sign*.28*p.turn,-sign*.20*p.turn));
 ar.spine.quaternion.multiply(q(.06*p.lower,sign*.10*p.turn,-sign*plan.angle*.60*p.lower));
 ar.chest.quaternion.multiply(q(-.06*p.settle,-sign*.06*p.turn,-sign*plan.angle*.40*p.settle));
 // A slight cheek turn around the head's own up axis does not lift the skull
 // off the thigh; avoid separately rolling/pitching the large head at contact.
 ar.head.quaternion.multiply(q(0,sign*.035*p.cheek,0));
 const legs=fade(time,1.15,2.80,7.80,8.65);
 for(const side of ['L','R'] as const){
  ar[side+'_thigh'].quaternion.multiply(q(.12*legs,0,(side==='L'?-1:1)*.035*legs));
  ar[side+'_shin'].quaternion.multiply(q(-.14*legs));
 }
 br.head.quaternion.multiply(q(.105*p.eye,0,-sign*.065*p.eye));
 // Keep B's pelvis/thigh fixed while looking down; hand targets then share a
 // stable support plane throughout the transfer and the two hair strokes.
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
 for(const side of ['L','R'] as const){
  const sideSign=side==='L'?1:-1;
  const shoulder=ar[side+'_upperArm'];
  if(!shoulder||!aResident.solver)continue;
  const hand=ar[side+'_hand'];
  const start=hand.localToWorld(furniturePalm(side));
  // Lift out of the resting pose first, then plant ahead of the hips. The
  // contact plane comes from the sofa seat, NEVER from the moving pelvis.
  const pad=initialHip.clone().addScaledVector(plan.slide,p.scoot).addScaledVector(right,sideSign*.32*scale)
   .addScaledVector(forward,.48*scale);
  pad.y=plan.seatY+.025*scale;
  const reach=sideSign===sign?smooth(time,.20,1.15):smooth(time,.40,1.40);
  const lift=Math.sin(Math.PI*reach)*.32*scale*(1-smooth(time,1.40,1.80));
  const target=start.clone().lerp(pad,reach);target.y=Math.max(target.y,pad.y)+lift;
  // On the lap both forearms rest in front of the torso, above the cushion.
  const rest=ar.chest.getWorldPosition(new T.Vector3()).addScaledVector(forward,.30*scale)
   .addScaledVector(right,sideSign*.12*scale);
  rest.y=Math.max(rest.y,plan.seatY+.16*scale);
  const restWeight=fade(time,3.05,3.65,6.35,7.10);
  target.lerp(rest,restWeight);
  target.y+=.22*scale*fade(time,8.10,8.45,8.85,9.30);
  const active=fade(time,.08,.65,8.30,9.30);
  solveLapHand(aResident,{side,point:target,direction:forward,normal:new T.Vector3(0,1,0),curl:.12-.02*active},active);
 }
 const sideB=lapPillowSide(b,a)>0?'L':'R';
 const forehead=clamp(p.first*.95+p.second*.76,0,1);
 const contact=lapPillowHeadContact(b,a,sideB,forehead,1-smooth(time,3.05,3.65));
 const touch=fade(time,1.50,2.65,6.35,7.15);
 solveLapHand(bResident,contact,touch);
 b.rig.setHandCurl(sideB,.12+.02*touch);
 return true;
}
