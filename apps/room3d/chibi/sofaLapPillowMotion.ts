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
 const lower=fade(time,.35,2.85,7.10,8.86);
 const brace=fade(time,.25,.74,1.90,2.70)+fade(time,7.0,7.40,8.40,9.06);
 const support=fade(time,1.00,1.80,2.67,3.12);
 const stroke=fade(time,2.90,3.18,6.78,7.30);
 const first=fade(time,3.20,4.22,4.22,4.70);
 const second=fade(time,4.86,6.18,6.18,6.74);
 const rise=smooth(time,7.25,8.92);
 return {lower,brace:clamp(brace,0,1),support,stroke,first,second,
  rise,cheek:fade(time,4.70,5.04,5.16,5.59),
  eye:fade(time,2.2,2.95,8.15,9.20)};
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
 const normal=up.clone().multiplyScalar(1.15).addScaledVector(front,towardForehead*.42).normalize();
 const center=a.getHeadWorldPosition();
 const point=center.clone().addScaledVector(up,size.height*.78)
  .addScaledVector(front,towardForehead*size.depth*.18);
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
 // Move the upper body as a chain; never twist a non-existent long neck.
 ar.hips.quaternion.multiply(q(0,0,-sign*1.12*p.lower));
 ar.spine.quaternion.multiply(q(-.065*p.lower,0,-sign*.20*p.lower));
 ar.chest.quaternion.multiply(q(-.055*p.lower,0,-sign*.09*p.lower));
 ar.head.quaternion.multiply(q(.035*p.eye,sign*.055*p.eye,sign*.05*p.cheek));
 br.spine.quaternion.multiply(q(.08*p.stroke+.06*p.support,0,sign*.025*p.stroke));
 br.chest.quaternion.multiply(q(.055*p.stroke,0,-sign*.022*p.eye));
 br.head.quaternion.multiply(q(.11*p.eye,0,-sign*.065*p.eye));
 // Short chibi legs retain their established seated folds. No upright reset.
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
 if(p.lower>.001){
  const target=lapPillowHeadTarget(a,b);
  const head=a.getHeadWorldPosition();
  const miss=target.sub(head);
  // Keep A's pelvis on the cushion: avoid a full-body teleport to fix the head.
  const slide=new T.Vector3(clamp(miss.x,-.55,.55),clamp(miss.y,-.52,.52),clamp(miss.z,-.30,.30));
  a.translatePose(slide.multiplyScalar(p.lower));
  a.root.updateWorldMatrix(true,true);
 }
 const sideA=sign>0?'R':'L';
 const sideB=lapPillowSide(b,a)>0?'L':'R';
 // A pushes on the near cushion before lying down and again when sitting up.
 if(p.brace>.001&&aResident.solver){
  const hip=ar.hips.getWorldPosition(new T.Vector3());
  const right=new T.Vector3(1,0,0).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
  const forward=new T.Vector3(0,0,1).applyQuaternion(a.root.getWorldQuaternion(new T.Quaternion()));
  const pad=hip.addScaledVector(right,-sign*.28).addScaledVector(forward,.19);
  pad.y=a.root.position.y+.56*a.root.getWorldScale(new T.Vector3()).y;
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
