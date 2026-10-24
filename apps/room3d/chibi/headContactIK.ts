import * as T from 'three';
import type {ChibiVisitor} from './visitor';

const lipOffset=new T.Vector3(0,.56,.23);
/** Approximate lip anchor in head-local coordinates. The rig has no lip bone. */
export function lipWorld(v:ChibiVisitor){
 v.root.updateWorldMatrix(true,true);
 return v.rig!.bones.head.localToWorld(lipOffset.clone());
}
/** Limited world-space aiming shared by kissing and future face contact actions.
 * Rotates neck and head toward the partner's lip anchor without translating roots. */
export function aimLipContact(v:ChibiVisitor,target:T.Vector3,weight:number){
 if(!v.rig||weight<=0)return;
 const head=v.rig.bones.head,neck=v.rig.bones.neck;
 for(const [bone,fraction,limit] of [[neck,.42,.10],[head,.58,.14]] as const){
  v.root.updateWorldMatrix(true,true);
  const lip=lipWorld(v),forward=new T.Vector3(0,0,1).applyQuaternion(head.getWorldQuaternion(new T.Quaternion()));
  const desired=target.clone().sub(lip);
  if(desired.lengthSq()<1e-6)continue;
  desired.normalize();
  const angle=Math.acos(T.MathUtils.clamp(forward.dot(desired),-1,1));
  const axis=new T.Vector3().crossVectors(forward,desired);
  if(axis.lengthSq()<1e-8)continue;
  axis.normalize();
  const parentWorld=bone.parent?.getWorldQuaternion(new T.Quaternion())??new T.Quaternion();
  axis.applyQuaternion(parentWorld.invert()).normalize();
  bone.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis,Math.min(angle*fraction*weight,limit)));
 }
 v.root.updateWorldMatrix(true,true);
}
