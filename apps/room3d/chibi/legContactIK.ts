import * as T from 'three';
import type {ChibiVisitor} from './visitor';

/** Reusable two-joint CCD correction for a planted toe or other leg-contact target.
 * Operates in world space, converts each correction to joint-local rotation,
 * and clamps each iteration to avoid knee flips on stylized rigs. */
export function settleLegContact(v:ChibiVisitor,side:'L'|'R',target:T.Vector3,strength:number){
 const bones=v.rig!.bones,toe=bones[side+'_toe'];
 for(let iteration=0;iteration<2;iteration++){
  for(const jointName of [side+'_shin',side+'_thigh']){
   const joint=bones[jointName],parent=joint.parent;
   if(!parent)continue;
   v.root.updateWorldMatrix(true,true);
   const pivot=joint.getWorldPosition(new T.Vector3());
   const current=toe.getWorldPosition(new T.Vector3()).sub(pivot);
   const desired=target.clone().sub(pivot);
   if(current.lengthSq()<1e-7||desired.lengthSq()<1e-7)continue;
   const worldDelta=new T.Quaternion().setFromUnitVectors(current.normalize(),desired.normalize());
   const axis=new T.Vector3(),angle=2*Math.acos(T.MathUtils.clamp(worldDelta.w,-1,1));
   if(angle<1e-5)continue;
   axis.set(worldDelta.x,worldDelta.y,worldDelta.z);
   if(axis.lengthSq()<1e-8)continue;
   axis.normalize();
   const parentWorld=parent.getWorldQuaternion(new T.Quaternion());
   axis.applyQuaternion(parentWorld.invert()).normalize();
   joint.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis,Math.min(angle,.075)*strength));
  }
 }
 v.root.updateWorldMatrix(true,true);
}
