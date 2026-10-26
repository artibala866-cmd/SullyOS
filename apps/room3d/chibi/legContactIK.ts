import * as T from 'three';
import type {ChibiVisitor} from './visitor';

/** Reusable two-joint CCD correction for a planted toe or other leg-contact target.
 * Operates in world space, converts each correction to joint-local rotation,
 * and clamps each iteration to avoid knee flips on stylized rigs. */
export function settleLegContact(v:Pick<ChibiVisitor,'root'|'rig'>,side:'L'|'R',target:T.Vector3,strength:number){
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

/** World-space stance snapshot for crouch/height interactions. Navigation is
 * deliberately untouched: all corrections stay on the temporary pose layer. */
export function captureLegSupport(v:ChibiVisitor){
 if(!v.rig)return null;
 v.root.updateWorldMatrix(true,true);
 const toes=(['L','R'] as const).map(side=>v.rig!.bones[side+'_toe'].getWorldPosition(new T.Vector3()));
 const soles=(['L','R'] as const).map(side=>v.rig!.bones[side+'_foot'].getWorldPosition(new T.Vector3()));
 const rotations=(['L','R'] as const).map(side=>v.rig!.bones[side+'_foot'].getWorldQuaternion(new T.Quaternion()));
 return {toes,rotations,ground:Math.min(...toes.map(p=>p.y),...soles.map(p=>p.y))};
}
/** Reconcile planted toes and original sole direction after a skeletal pose.
 * Keep the new bending of knees, but avoid sliding or rolling planted feet. */
export function restoreLegSupport(v:ChibiVisitor,support:ReturnType<typeof captureLegSupport>,preserveFootDirection=true){
 if(!v.rig||!support)return 0;
 v.root.updateWorldMatrix(true,true);
 for(const [i,side] of (['L','R'] as const).entries()){
  if(preserveFootDirection){
   const foot=v.rig.bones[side+'_foot'],parent=foot.parent;
   if(parent)foot.quaternion.copy(parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(support.rotations[i]));
  }
  settleLegContact(v,side,support.toes[i],1);
 }
 v.root.updateWorldMatrix(true,true);
 const ground=Math.min(...(['L','R'] as const).flatMap(side=>[
  v.rig!.bones[side+'_toe'].getWorldPosition(new T.Vector3()).y,
  v.rig!.bones[side+'_foot'].getWorldPosition(new T.Vector3()).y,
 ]));
 const correction=T.MathUtils.clamp(support.ground-ground,-.16,.16);
 if(Math.abs(correction)>1e-5)v.translatePose(new T.Vector3(0,correction,0));
 v.root.updateWorldMatrix(true,true);
 return correction;
}

/** One world-space stance foot at a time. This is a correction layer on top of
 * authored walking poses, not an alternate walk clip or a new skeletal bone. */
export function createWorldFootLock(){
 let side:'L'|'R'|null=null,locked=new T.Vector3(),previousRoot=new T.Vector3();
 let previousTime:number|null=null;
 const reset=()=>{side=null;previousTime=null;};
 return {reset,get supportSide(){return side;},apply(
  v:Pick<ChibiVisitor,'root'|'rig'>,time:number,speed:number,walking=true
 ){
  if(!walking||!v.rig||!Number.isFinite(time)||!Number.isFinite(speed)||speed<=0){reset();return;}
  v.root.updateWorldMatrix(true,true);
  const root=v.root.getWorldPosition(new T.Vector3());
  const dt=previousTime===null?0:time-previousTime;
  if(previousTime!==null&&(dt<=0||dt>.35||root.distanceTo(previousRoot)>Math.max(.22,3*speed*dt)))reset();
  previousRoot.copy(root);previousTime=time;
  const toes={L:v.rig.bones.L_toe.getWorldPosition(new T.Vector3()),R:v.rig.bones.R_toe.getWorldPosition(new T.Vector3())};
  const candidate:'L'|'R'=toes.L.y<=toes.R.y?'L':'R';
  const toeScale=v.rig.bones.L_toe.getWorldScale(new T.Vector3()).x;
  const hysteresis=Math.max(.008,Math.abs(toeScale)*.012);
  const other=side==='L'?'R':'L';
  // Crossing a small vertical margin changes the planted foot; a tie keeps
  // the previous contact so the solver cannot chatter at phase boundaries.
  if(side===null||toes[other].y+hysteresis<toes[side].y){
   side=candidate;locked.copy(toes[side]);return;
  }
  // Don't drag the planted foot through a teleport or impossible stride.
  const reach=(v.rig.bones[side+'_forearm']?.position.length()??.2)+
   v.rig.bones[side+'_shin'].position.length();
  if(locked.distanceTo(toes[side])>Math.max(.18,reach*.6)){locked.copy(toes[side]);return;}
  settleLegContact(v,side,locked,.95);
 }};
}
