import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver,Contact} from './socialContact';
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
 // A cannot tip sideways as a rigid doll. They first plant a palm, ease
 // their hips onto the cushion, progressively incline the back, and only then
 // transfer the head's weight to B's thigh. Rising reverses this causal order.
 const brace=fade(time,.08,1.30,2.07,3.42)+fade(time,6.60,7.87,8.00,9.30);
 const scoot=fade(time,.42,1.85,7.90,9.30);
 const turn=fade(time,.55,1.97,8.00,9.30);
 const lower=fade(time,.76,2.65,7.55,9.30);
 const settle=fade(time,1.86,3.06,7.00,8.32);
 const headLift=smooth(time,7.55,8.38);
 const support=fade(time,.84,1.62,2.67,3.25);
 const stroke=fade(time,2.98,3.27,6.74,7.24);
 const first=fade(time,3.26,4.16,4.16,4.78);
 const second=fade(time,4.88,6.10,6.10,6.78);
 const rise=smooth(time,7.34,9.18);
 return {
  lower,brace:clamp(brace,0,1),scoot,turn,settle,headLift,
  support,stroke,first,second,rise,
  cheek:fade(time,4.66,5.07,5.20,5.70),
  eye:fade(time,1.30,2.78,8.63,9.28)
 };
}

export function lapPillowSide(a:ChibiVisitor,b:ChibiVisitor):1|-1{
 const right=new T.Vector3(1,0,0).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
 return b.root.getWorldPosition(new T.Vector3()).sub(a.root.getWorldPosition(new T.Vector3())).dot(right)>=0?1:-1;
}

/** Anchor is measured from the actual B thigh, not a fixed standing head Y.
 * The head radius (including hair/large head) is kept ABOVE the leg surface.
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
 const radius=headPatScalpSize(a).radius;
 const up=new T.Vector3(0,1,0);
 // The thigh is an upper-leg anchor, not a scalp support plane.
 point.addScaledVector(up,radius*.78+.085);
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
 const wrist=b.rig!.bones[side+'_upperArm']?.getWorldPosition(new T.Vector3());
 const sideSign=wrist&&wrist.clone().sub(a.getHeadWorldPosition()).dot(across)<0?-1:1;
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
 const tangent=front.clone().lerp(up,hold);
 const direction=tangent.addScaledVector(normal,-tangent.dot(normal));
 if(direction.lengthSq()<1e-7)direction.crossVectors(normal,new T.Vector3(1,0,0));
 direction.normalize();
 return {side,point,direction,normal,curl:.18};
}

/** Direct seated pose: the sofa keeps both hips grounded. A's torso rolls
 * towards B while B's free shoulder remains relaxed. Large-head corrections
 * are bounded on the existing motion body (not the navigation roots).
 */
export function poseSofaLapPillow(both:readonly [Resident,Resident],time:number){
 const [aResident,bResident]=both;
 const a=aResident?.visitor,b=bResident?.visitor;
 if(!a?.rig||!b?.rig)return false;
 const p=sofaLapPillowPhase(time);
 const sign=lapPillowSide(a,b);
 const ar=a.rig.bones,br=b.rig.bones;
 // 1) A braces and redistributes seat weight. Rotate the PELVIS barely at
 // all, so both folded legs and the seat contact stay anchored.
 ar.hips.quaternion.multiply(q(0,sign*.10*p.turn,-sign*.105*p.turn));
 // 2) With hips stable, the short spine and chest side-fold in sequence.
 // Their total lean reads as a sideways recline, not one stiff vertical rod.
 ar.spine.quaternion.multiply(q(-.085*p.lower,sign*.075*p.turn,-sign*.79*p.lower));
 ar.chest.quaternion.multiply(q(-.062*p.lower,0,-sign*.39*smooth(time,1.13,2.72)*(1-smooth(time,7.55,9.30))));
 ar.neck.quaternion.multiply(q(0,0,-sign*.055*p.lower));
 // A turns the face toward B while the skull comes down; cheek nestle is a
 // single small voluntary motion, not a second fast oscillation.
 ar.head.quaternion.multiply(q(.052*p.eye,sign*(.10*p.eye+.047*p.cheek),sign*(.085*p.lower+.055*p.cheek)));
 // B notices A early, leans a little forward and lowers their gaze before
 // reaching, without the shoulders pulsing independently.
 br.spine.quaternion.multiply(q(.055*p.support+.045*p.stroke,0,sign*.024*p.stroke));
 br.chest.quaternion.multiply(q(.040*p.support+.045*p.stroke,0,-sign*.023*p.eye));
 br.head.quaternion.multiply(q(.105*p.eye,0,-sign*.065*p.eye));
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
 // Relax the knees a little into the cushion instead of leaving both
 // legs in the exact rigid chair-rest angles while the upper body lies down.
 const legs=smooth(time,1.25,2.85)*(1-smooth(time,7.65,9.25));
 for(const side of ['L','R'] as const){
  ar[side+'_thigh'].quaternion.multiply(q(.18*legs,0,(side==='L'?-1:1)*.035*legs));
  ar[side+'_shin'].quaternion.multiply(q(-.21*legs));
  ar[side+'_foot'].quaternion.multiply(q(.035*legs));
 }
 // 3) Gentle cushion scoot is an authored, smoothly easing seat adjustment.
 // Root and sofa stay fixed; do not force the WHOLE body to chase the head at
 // every frame. Allow a smaller final settling adjustment only near the lap.
 const scale=Math.min(a.root.getWorldScale(new T.Vector3()).x,b.root.getWorldScale(new T.Vector3()).x);
 const right=new T.Vector3(1,0,0).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
 const forward=new T.Vector3(0,0,1).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
 if(p.scoot>.001){
  const slide=right.multiplyScalar(sign*.36*scale*p.scoot)
   .addScaledVector(forward,.055*scale*p.scoot);
  a.translatePose(slide);
 }
 if(p.settle>.001){
  a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
  const miss=lapPillowHeadTarget(a,b).sub(a.getHeadWorldPosition());
  // Only settle the last short gap after the torso has already reclined;
  // avoid large vertical hip excursions and leg/cushion penetration.
  const available=scale;
  const correction=new T.Vector3(
   clamp(miss.x,-.34*available,.34*available),
   clamp(miss.y,-.11*available,.11*available),
   clamp(miss.z,-.14*available,.14*available)
  );
  a.translatePose(correction.multiplyScalar(p.settle));
 }
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
 const sideA=sign>0?'R':'L';
 const sideB=lapPillowSide(b,a)>0?'L':'R';
 // A pushes on the near cushion before lying down and again when sitting up.
 if(p.brace>.001&&aResident.solver){
  const hip=ar.hips.getWorldPosition(new T.Vector3());
  const right=new T.Vector3(1,0,0).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
  const forward=new T.Vector3(0,0,1).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
  const pad=hip.addScaledVector(right,-sign*.28).addScaledVector(forward,.19);
  pad.y=ar.hips.getWorldPosition(new T.Vector3()).y-.055*a.root.getWorldScale(new T.Vector3()).y;
  aResident.solver({
   side:sideA,point:pad,direction:forward,normal:new T.Vector3(0,1,0),curl:.08,
  },p.brace*.65);
 }
 // B catches the back of the head; after the transfer the same hand performs
 // two distinct, slower-than-shoulder strokes across the scalp.
 // Each stroke travels from crown to temple and softly returns, with zero
 // hand velocity at both endpoints. Do not snap back between repetitions.
 const forehead=clamp(p.first*.95+p.second*.76,0,1);
 const contact=lapPillowHeadContact(b,a,sideB,forehead,p.support*(1-smooth(time,2.70,3.14)));
 const touch=Math.max(p.support,p.stroke);
 if(touch>.001) bResident.solver?.(contact,touch*.92);
 // B's other palm relaxes by the cushion; no repeated opposite-shoulder twitch.
 b.rig.setHandCurl(sideB,.14);
 return true;
}
