import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {palmContactReport,type Contact} from './socialContact';

type Side='L'|'R';
// Torso units are CHEST BONE LOCAL units, not room/world units. All targets
// and collision tests use exactly the same proxy and follow the posed chest.
const CENTRE=new T.Vector3(0,-.10,0);
const RADII=new T.Vector3(.56,.74,.40);
const ARM_RADII=new T.Vector3(.60,.78,.44);

function normalizedRadius(point:T.Vector3,radii:T.Vector3){
 const x=(point.x-CENTRE.x)/radii.x;
 const y=(point.y-CENTRE.y)/radii.y;
 const z=(point.z-CENTRE.z)/radii.z;
 return Math.sqrt(x*x+y*y+z*z);
}

/** A rear-flank contact ON the recipient's outside surface, not in its chest.
 * Slightly different hand heights keep the two pairs of arms from stacking. */
export function hugBackSurface(recipient:ChibiVisitor,side:Side,role:number){
 const sign=side==='L'?1:-1;
 const x=-sign*.46,y=role===0?-.15:-.26;
 const plane=1-(x/RADII.x)**2-((y-CENTRE.y)/RADII.y)**2;
 const z=-RADII.z*Math.sqrt(Math.max(.02,plane))-.07;
 recipient.root.updateWorldMatrix(true,true);
 return recipient.rig!.bones.chest.localToWorld(new T.Vector3(x,y,z));
}

/** Keep the approach/wrap path outside the same torso used by the elbow solver. */
export function hugOutsideTarget(recipient:ChibiVisitor,target:T.Vector3){
 recipient.root.updateWorldMatrix(true,true);
 const chest=recipient.rig!.bones.chest;
 const local=chest.worldToLocal(target.clone());
 const radius=normalizedRadius(local,RADII);
 if(radius<1.09){
  const offset=local.sub(CENTRE);
  if(radius<1e-5)offset.set(0,0,-RADII.z*1.09);
  else offset.multiplyScalar(1.09/radius);
  target.copy(chest.localToWorld(offset.add(CENTRE)));
 }
 return target;
}

function rotateToward(joint:T.Bone,end:T.Bone,target:T.Vector3,weight:number){
 const parent=joint.parent;
 if(!parent)return;
 const pivot=joint.getWorldPosition(new T.Vector3());
 const from=end.getWorldPosition(new T.Vector3()).sub(pivot);
 const to=target.clone().sub(pivot);
 if(from.lengthSq()<1e-8||to.lengthSq()<1e-8)return;
 const delta=new T.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());
 const q=parent.getWorldQuaternion(new T.Quaternion());
 const local=q.clone().invert().multiply(delta).multiply(q);
 const original=joint.quaternion.clone();
 joint.quaternion.premultiply(local);
 joint.quaternion.copy(original.slerp(joint.quaternion,weight));
}

/**
 * Hug-only elbow pole correction, AFTER the shared palm IK.
 * Both arm segments are solved together toward a fixed wrist: rotating the
 * shoulder alone would pull the palm off the back and cause the old regression.
 * If the palm error or penetration gets worse, restore the original pose.
 */
export function keepHugArmOutside(owner:ChibiVisitor,recipient:ChibiVisitor,contact:Contact,weight:number){
 if(!owner.rig||!recipient.rig||weight<.15)return;
 const side=contact.side,rig=owner.rig;
 const shoulder=rig.bones[side+'_upperArm'],elbow=rig.bones[side+'_forearm'],hand=rig.bones[side+'_hand'];
 owner.root.updateWorldMatrix(true,true);
 recipient.root.updateWorldMatrix(true,true);
 const chest=recipient.rig.bones.chest;
 const inv=chest.matrixWorld.clone().invert();
 const s=shoulder.getWorldPosition(new T.Vector3());
 const e=elbow.getWorldPosition(new T.Vector3());
 const w=hand.getWorldPosition(new T.Vector3());
 const upper=e.distanceTo(s),lower=w.distanceTo(e),distance=w.distanceTo(s);
 if(upper<.01||lower<.01||distance<.01||distance>=upper+lower-.005||distance<=Math.abs(upper-lower)+.005)return;

 const originalUpper=shoulder.quaternion.clone(),originalForearm=elbow.quaternion.clone(),originalHand=hand.quaternion.clone();
 const handWorld=hand.getWorldQuaternion(new T.Quaternion());
 const before=palmContactReport(owner,contact);
 const errorBefore=before?.error??Infinity;
 const penetration=(a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{
  let depth=0;
  for(const [start,end] of [[a,b],[b,c]]){
   for(let i=1;i<=4;i++){
    const p=start.clone().lerp(end,i/4).applyMatrix4(inv);
    depth=Math.max(depth,1-normalizedRadius(p,ARM_RADII));
   }
  }
  return Math.max(0,depth);
 };
 const beforeDepth=penetration(s,e,w);
 const axis=w.clone().sub(s).normalize();
 const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
 const radius=Math.sqrt(Math.max(0,upper*upper-along*along));
 if(radius<.015)return;
 const centre=s.clone().addScaledVector(axis,along);
 // The preferred elbow pole points to the hugging person's OUTER side.
 // Sample the valid two-bone elbow circle, not arbitrary shoulder rotations.
 const sideSign=side==='L'?1:-1;
 const pole=new T.Vector3(sideSign,0,0).applyQuaternion(owner.root.getWorldQuaternion(new T.Quaternion()));
 pole.add(s.clone().sub(chest.getWorldPosition(new T.Vector3())).multiplyScalar(.22));
 pole.addScaledVector(axis,-pole.dot(axis));
 if(pole.lengthSq()<1e-7)pole.set(0,1,0).addScaledVector(axis,-axis.y);
 if(pole.lengthSq()<1e-7)return;
 pole.normalize();
 const cross=new T.Vector3().crossVectors(axis,pole).normalize();
 const currentPole=e.clone().sub(centre).normalize();
 const baseScore=beforeDepth*8+.055*(1-currentPole.dot(pole));
 let bestScore=baseScore,bestElbow:T.Vector3|null=null;
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6;
  const direction=pole.clone().multiplyScalar(Math.cos(angle)).addScaledVector(cross,Math.sin(angle));
  const candidate=centre.clone().addScaledVector(direction,radius);
  const depth=penetration(s,candidate,w);
  const score=depth*8+.055*(1-direction.dot(pole))+.10*candidate.distanceTo(e);
  if(score<bestScore-.003){bestScore=score;bestElbow=candidate;}
 }
 if(!bestElbow)return;
 const blend=T.MathUtils.smoothstep(weight,.15,.7);
 rotateToward(shoulder,elbow,bestElbow,blend);
 owner.root.updateWorldMatrix(true,true);
 rotateToward(elbow,hand,w,blend);
 owner.root.updateWorldMatrix(true,true);
 // Restore the authored palm orientation in world space after parent moves.
 const parentQ=hand.parent!.getWorldQuaternion(new T.Quaternion());
 hand.quaternion.copy(parentQ.invert().multiply(handWorld));
 owner.root.updateWorldMatrix(true,true);
 const after=palmContactReport(owner,contact);
 const actualElbow=elbow.getWorldPosition(new T.Vector3());
 const actualWrist=hand.getWorldPosition(new T.Vector3());
 const afterDepth=penetration(s,actualElbow,actualWrist);
 const excessiveError=!after||after.error>Math.max(.055,errorBefore+.018);
 const worseCollision=afterDepth>beforeDepth+.008;
 if(excessiveError||worseCollision){
  shoulder.quaternion.copy(originalUpper);
  elbow.quaternion.copy(originalForearm);
  hand.quaternion.copy(originalHand);
  owner.root.updateWorldMatrix(true,true);
 }
}
