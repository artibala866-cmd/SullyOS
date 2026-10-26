import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {BLANK_SCALE,BLANK_HEAD_SCALE,fitBlankHeadY} from './blankBody';

/**
 * The face is part of the skinned blank-body surface, not a separate lip bone.
 * Derive the mouth anchor from the same source-space head proportions used to
 * build that surface. This keeps headSize/bodyHeight variants in sync.
 *
 * Source coordinates: the visible front of the face is +Z; the mouth lies
 * below the face centre. Keep these landmarks together for future face actions.
 */
const MOUTH_SOURCE_Y=.235;
const FACE_SOURCE_Z=.132;
const lipOffsetFor=(v:ChibiVisitor)=>{
 const rig=v.rig!;
 const head=rig.bones.head;
 // Geometry is fitted with headSize and bodyHeight, while the rig head pivot
 // follows bodyHeightY. Derive the local offset from the actual rest pivot.
 const height=rig.bodyHeight;
 const size=(rig.mesh.geometry.userData.headSize as number|undefined)??1;
 const mouthY=fitBlankHeadY((MOUTH_SOURCE_Y+.5)*BLANK_SCALE,{bodyHeight:height,headSize:size});
 // Head bone position is a rest-space offset from its parent; recover its
 // unposed world-independent bind position from the skeleton bone inverse.
 const index=rig.skeleton.bones.indexOf(head);
 const bindWorld=new T.Matrix4().copy(rig.skeleton.boneInverses[index]).invert();
 const bindPoint=new T.Vector3(0,mouthY,FACE_SOURCE_Z*BLANK_SCALE*BLANK_HEAD_SCALE.z*size);
 return bindPoint.applyMatrix4(bindWorld.invert());
};
/** Mouth anchor in posed world coordinates, including head scale and rotation. */
export function lipWorld(v:ChibiVisitor){
 v.root.updateWorldMatrix(true,true);
 return v.rig!.bones.head.localToWorld(lipOffsetFor(v));
}
/** Limited world-space aiming shared by kissing and future face contact actions. */
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

/** Project the anatomical mouth onto the actual skin once, before navigation. */
export function surfaceLipLocal(v:ChibiVisitor){
 const seed=lipWorld(v),head=v.rig!.bones.head;
 const forward=new T.Vector3(0,0,1).applyQuaternion(head.getWorldQuaternion(new T.Quaternion()));
 v.root.updateMatrixWorld(true);v.rig!.skeleton.update();
 v.rig!.mesh.boundingSphere=null;v.rig!.mesh.boundingBox=null;
 const hit=new T.Raycaster(seed.clone().add(forward),forward.clone().negate(),0,2).intersectObject(v.rig!.mesh,false)[0];
 return head.worldToLocal(hit?.point.clone()??seed);
}
