import * as T from 'three';
import {CCDIKSolver} from 'three/examples/jsm/animation/CCDIKSolver.js';
import type {ChibiVisitor} from './visitor';
import {furnitureHandRotation,furniturePalm} from './furnitureMotion';
import {constrainForearmTwist} from '../../../experiments/chibi/forearmTwist';
export type HandSide='R'|'L';
export type Contact={side:HandSide;point:T.Vector3;direction:T.Vector3;normal:T.Vector3;curl?:number};
/** An anatomical target stored in the receiving bone's local frame. */
export type BodyContactAnchor={bone:T.Object3D;offset:T.Vector3;direction:T.Vector3;normal:T.Vector3};
export function bodyContactAnchor(bone:T.Object3D,offset:T.Vector3,direction:T.Vector3,normal:T.Vector3):BodyContactAnchor{
 return {bone,offset:offset.clone(),direction:direction.clone(),normal:normal.clone()};
}
export function resolveBodyContact(anchor:BodyContactAnchor,side:HandSide,curl?:number):Contact{
 anchor.bone.updateWorldMatrix(true,false);
 const q=anchor.bone.getWorldQuaternion(new T.Quaternion());
 return {side,point:anchor.bone.localToWorld(anchor.offset.clone()),direction:anchor.direction.clone().applyQuaternion(q),normal:anchor.normal.clone().applyQuaternion(q),curl};
}
/** Shared world-space palm target for a two-handed contact, avoiding chase loops. */
export function sharedPalmTarget(a:T.Vector3,b:T.Vector3){return a.clone().add(b).multiplyScalar(.5);}
export type ContactReport={side:HandSide;error:number;reached:boolean;target:T.Vector3;actual:T.Vector3};
export function palmContactReport(visitor:ChibiVisitor,contact:Contact,tolerance=.055):ContactReport|null{
 if(!visitor.rig)return null;
 const hand=visitor.rig.bones[contact.side+'_hand'];
 visitor.root.updateWorldMatrix(true,true);
 const actual=hand.localToWorld(furniturePalm(contact.side));
 const error=actual.distanceTo(contact.point);
 return {side:contact.side,error,reached:error<=tolerance,target:contact.point.clone(),actual};
}
/** Persistent target descriptor: re-resolve after the recipient's pose each frame. */
export function createHandContactLock(anchor:BodyContactAnchor,side:HandSide,curl?:number){
 let engaged=false;
 return {
  engage(){engaged=true;},
  release(){engaged=false;},
  get active(){return engaged;},
  resolve(){return engaged?resolveBodyContact(anchor,side,curl):null;},
 };
}
/** Reusable, frame-independent contact recipe for authored social motions.
 * Call after both actors' torso poses are updated; do not retain world targets. */
export type ContactRecipe={
 side:HandSide;targetBone:string;offset:readonly [number,number,number];
 direction:readonly [number,number,number];normal:readonly [number,number,number];curl?:number;
};
export function contactFromRecipe(recipient:ChibiVisitor,recipe:ContactRecipe):Contact|null{
 const bone=recipient.rig?.bones[recipe.targetBone];
 if(!bone)return null;
 return resolveBodyContact(bodyContactAnchor(
  bone,new T.Vector3(...recipe.offset),new T.Vector3(...recipe.direction),new T.Vector3(...recipe.normal)
 ),recipe.side,recipe.curl);
}
/** Optional shared helper: authored motions supply a recipe and blend weight. */
export function applyContactRecipe(
 recipient:ChibiVisitor,recipe:ContactRecipe,
 solve:ReturnType<typeof contactSolver>,weight:number
){
 const contact=contactFromRecipe(recipient,recipe);
 if(contact&&solve&&weight>0)solve(contact,weight);
 return contact;
}
export function contactSolver(visitor:ChibiVisitor){
 const rig=visitor.rig;if(!rig)return null;
 const goals=[new T.Bone(),new T.Bone()],bones=[...rig.skeleton.bones,...goals];
 const chains=['R','L'].map((side,i)=>({target:rig.skeleton.bones.length+i,effector:bones.indexOf(rig.bones[side+'_hand']),iteration:48,maxAngle:.16,links:['forearm','upperArm'].map(n=>({index:bones.indexOf(rig.bones[side+'_'+n])}))}));
 const solver=new CCDIKSolver({skeleton:{bones}} as T.SkinnedMesh,chains);
 const pose=Object.fromEntries(Object.keys(rig.bones).map(n=>[n,new T.Quaternion()]));
 return (contact:Contact,weight:number)=>{
  if(weight<=0||!Number.isFinite(weight))return;
  const strength=T.MathUtils.clamp(weight,0,1);
  if(![contact.point,contact.direction,contact.normal].every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)&&Number.isFinite(v.z)))return;
  if(contact.direction.lengthSq()<1e-8||contact.normal.lengthSq()<1e-8)return;
  const i=contact.side==='R'?0:1,hand=rig.bones[contact.side+'_hand'];
  visitor.root.updateWorldMatrix(true,true);
  const rotation=furnitureHandRotation(contact.side,contact.direction.toArray(),contact.normal.toArray());
  const scale=hand.getWorldScale(new T.Vector3()).y;
  const wrist=contact.point.clone().sub(furniturePalm(contact.side).multiplyScalar(scale).applyQuaternion(rotation));
  goals[i].matrixWorld.makeTranslation(wrist.x,wrist.y,wrist.z);solver.updateOne(chains[i],strength);
  const local=hand.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation);
  hand.quaternion.slerp(local,strength);
  // A caller with individually authored fingers owns its own hand shape.
  if(contact.curl!==undefined)rig.setHandCurl(contact.side,contact.curl*strength);
  for(const [n,b] of Object.entries(rig.bones))pose[n].copy(b.quaternion);
  constrainForearmTwist(rig,pose,contact.side);
  for(const suffix of ['twist1','twist2','twist3'])rig.bones[contact.side+'_'+suffix]?.quaternion.copy(pose[contact.side+'_'+suffix]);
  visitor.root.updateWorldMatrix(true,true);
 };
}
