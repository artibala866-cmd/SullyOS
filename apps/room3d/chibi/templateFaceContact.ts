import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {faceContactWorld,faceContactRecipes,faceContactEnvelope} from './faceContactProfiles';

/**
 * Optional face-contact template adapter. This only steers neck/head rotation
 * toward configured landmarks; it NEVER moves either resident root and does
 * not replace the approved procedural kiss. Works after pose + clearance.
 */
export function applyTemplateFaceContact(
 name:keyof typeof faceContactRecipes,
 both:readonly [ChibiVisitor,ChibiVisitor],
 time:number,weight:number
):boolean{
 const recipe=faceContactRecipes[name];
 const strength=weight*faceContactEnvelope(recipe,time);
 if(strength<=0||!both.every(v=>v.rig))return false;
 const a=both[0],b=both[1];
 const targetA=faceContactWorld(b,recipe.to);
 const targetB=recipe.from===recipe.to?faceContactWorld(a,recipe.from):null;
 if(!targetA)return false;
 const aim=(v:ChibiVisitor,point:typeof recipe.from,target:T.Vector3,amount:number)=>{
  const rig=v.rig!;
  const head=rig.bones.head,neck=rig.bones.neck;
  if(!head||!neck)return;
  for(const [bone,fraction,limit] of [[neck,.42,.075],[head,.58,.11]] as const){
   v.root.updateWorldMatrix(true,true);
   const source=faceContactWorld(v,point),pivot=head.getWorldPosition(new T.Vector3());
   if(!source)return;
   const forward=source.sub(pivot),desired=target.clone().sub(pivot);
   if(forward.lengthSq()<1e-7||desired.lengthSq()<1e-7)continue;
   forward.normalize();desired.normalize();
   const angle=Math.acos(T.MathUtils.clamp(forward.dot(desired),-1,1));
   const axis=new T.Vector3().crossVectors(forward,desired);
   if(axis.lengthSq()<1e-8)continue;
   const parentQ=bone.parent?.getWorldQuaternion(new T.Quaternion())??new T.Quaternion();
   axis.normalize().applyQuaternion(parentQ.invert()).normalize();
   bone.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis,Math.min(limit,angle*fraction*amount)));
  }
  v.root.updateWorldMatrix(true,true);
 };
 aim(a,recipe.from,targetA,strength);
 if(targetB)aim(b,recipe.to,targetB,strength*.75);
 return true;
}
