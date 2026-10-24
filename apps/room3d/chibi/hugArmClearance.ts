import * as T from 'three';
import type {ChibiVisitor} from './visitor';

type Side='L'|'R';
/** Cheap, reusable post-IK hug clearance. A torso ellipsoid is measured in
 * the recipient's chest frame, so turning/leaning does not invalidate it.
 * Only the hugging arm is adjusted; the recipient and navigation roots stay put.
 * No motion-clip sampling, allocations of physics bodies, or loading work. */
export function keepHugArmOutside(owner:ChibiVisitor,recipient:ChibiVisitor,side:Side,weight:number){
 if(!owner.rig||!recipient.rig||weight<=.001)return;
 const chest=recipient.rig.bones.chest;
 const upper=owner.rig.bones[side+'_upperArm'];
 const elbow=owner.rig.bones[side+'_forearm'];
 const wrist=owner.rig.bones[side+'_hand'];
 owner.root.updateWorldMatrix(true,true);
 recipient.root.updateWorldMatrix(true,true);
 const inv=chest.matrixWorld.clone().invert();
 // Torso proxy includes a small sleeve clearance. The forearm midpoint is
 // checked too: a clear wrist alone does not mean the arm clears the ribs.
 const radii=new T.Vector3(.54,.73,.43);
 const penetration=()=>{
  owner.root.updateWorldMatrix(true,true);
  recipient.root.updateWorldMatrix(true,true);
  const e=elbow.getWorldPosition(new T.Vector3()),h=wrist.getWorldPosition(new T.Vector3());
  let worst=0;
  for(const t of [0,.5,1]){
   const p=e.clone().lerp(h,t).applyMatrix4(inv);
   const depth=1-Math.sqrt((p.x/radii.x)**2+(p.y/radii.y)**2+(p.z/radii.z)**2);
   worst=Math.max(worst,depth);
  }
  return worst;
 };
 const before=penetration();
 if(before<=.01)return;
 const original=upper.quaternion.clone();
 let best=before,bestQ=original;
 // Try small shoulder-out rotations; retain only an improvement. This
 // avoids forcing the wrist through the torso with a second blind IK solve.
 for(const sign of [side==='L'?1:-1,side==='L'?-1:1]){
  upper.quaternion.copy(original).multiply(new T.Quaternion().setFromEuler(new T.Euler(0,sign*.16*weight,sign*.12*weight)));
  const depth=penetration();
  if(depth<best){best=depth;bestQ=upper.quaternion.clone();}
 }
 upper.quaternion.copy(bestQ);
 owner.root.updateWorldMatrix(true,true);
}
