import * as T from 'three';
import type {ChibiVisitor} from './visitor';

/** Reusable two-joint CCD correction for a planted toe or other leg-contact target.
 * Operates in world space, converts each correction to joint-local rotation,
 * and clamps each iteration to avoid knee flips on stylized rigs. */
export function settleLegContact(
 v:Pick<ChibiVisitor,'root'|'rig'>,side:'L'|'R',target:T.Vector3,strength:number,
 options:{iterations?:number;maxAngle?:number;maxTotalAngle?:number;effector?:'toe'|'foot'}={}
){
 const bones=v.rig!.bones,toe=bones[side+'_'+(options.effector??'toe')];
 const iterations=Math.max(1,Math.min(10,options.iterations??2));
 const maxAngle=T.MathUtils.clamp(options.maxAngle??.075,.01,.18);
 // Only furniture stance callers request this bound. Ordinary walk and
 // seated-surface IK retain their previously approved correction budget.
 const authored=options.maxTotalAngle===undefined?null:new Map(
  [side+'_shin',side+'_thigh'].map(name=>[name,bones[name].quaternion.clone()] as const));
 for(let iteration=0;iteration<iterations;iteration++){
  for(const jointName of [side+'_shin',side+'_thigh']){
   const joint=bones[jointName],parent=joint.parent;
   if(!parent)continue;
   v.root.updateWorldMatrix(true,true);
   if(toe.getWorldPosition(new T.Vector3()).distanceTo(target)<.003)break;
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
   joint.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(axis,Math.min(angle,maxAngle)*T.MathUtils.clamp(strength,0,1)));
   const original=authored?.get(jointName);
   if(original){
    const total=joint.quaternion.angleTo(original),cap=options.maxTotalAngle!;
    if(total>cap)joint.quaternion.copy(original).slerp(joint.quaternion,cap/total);
   }
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
 return {toes,soles,rotations,ground:Math.min(...toes.map(p=>p.y),...soles.map(p=>p.y))};
}
/** Reconcile planted toes and original sole direction after a skeletal pose.
 * Keep the new bending of knees, but avoid sliding or rolling planted feet. */
export function restoreLegSupport(v:ChibiVisitor,support:ReturnType<typeof captureLegSupport>,preserveFootDirection=true,maxCorrection=.16,strength=1,onlySide:'L'|'R'|null=null){
 const alpha=T.MathUtils.clamp(strength,0,1);
 if(!v.rig||!support||alpha<=0)return 0;
 v.root.updateWorldMatrix(true,true);
 for(const [i,side] of (['L','R'] as const).entries()){
  if(onlySide&&side!==onlySide)continue;
  // Solve the ankle first: a fixed sole orientation determines its toe
  // offset. Solving the toe and then rotating its ancestors breaks that
  // orientation; restoring it afterwards would move the toe off target.
  settleLegContact(v,side,preserveFootDirection?support.soles[i]:support.toes[i],alpha,{effector:preserveFootDirection?'foot':'toe'});
  if(preserveFootDirection){
   const foot=v.rig.bones[side+'_foot'],parent=foot.parent;
   if(parent)foot.quaternion.slerp(parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(support.rotations[i]),alpha);
  }
 }
 v.root.updateWorldMatrix(true,true);
 const ground=Math.min(...(['L','R'] as const).filter(side=>!onlySide||side===onlySide).flatMap(side=>[
  v.rig!.bones[side+'_toe'].getWorldPosition(new T.Vector3()).y,
  v.rig!.bones[side+'_foot'].getWorldPosition(new T.Vector3()).y,
 ]));
 const correction=T.MathUtils.clamp(support.ground-ground,-maxCorrection,maxCorrection)*alpha;
 if(Math.abs(correction)>1e-5)v.translatePose(new T.Vector3(0,correction,0));
 v.root.updateWorldMatrix(true,true);
 return correction;
}

/** One world-space stance foot at a time. This is a correction layer on top of
 * authored walking poses, not an alternate walk clip or a new skeletal bone. */
export function createWorldFootLock(){
 let side:'L'|'R'|null=null,locked=new T.Vector3(),previousRoot=new T.Vector3();
 const lockRoot=new T.Vector3();
let previousTime:number|null=null,awaitingOpposite:'L'|'R'|null=null;
type LegPose={side:'L'|'R';thigh:T.Quaternion;shin:T.Quaternion};
let lastCorrected:LegPose|null=null,releasePose:(LegPose&{start:number})|null=null;
// The gait sampler resets the skeleton at every frame. Fade the just-released
// IK leg toward its authored swing over a short window; an abrupt switch can
// otherwise jump a toe >20cm in one 60Hz frame.
const beginRelease=(time:number,outgoing:'L'|'R')=>{
 if(lastCorrected?.side===outgoing)releasePose={...lastCorrected,start:time};
 lastCorrected=null;
};
const fadeRelease=(v:Pick<ChibiVisitor,'rig'|'root'>,time:number)=>{
 if(!releasePose||!v.rig)return;
 const remaining=T.MathUtils.clamp(1-(time-releasePose.start)/.12,0,1);
 if(remaining<=0){releasePose=null;return;}
 const alpha=.78*remaining*remaining,side=releasePose.side;
 v.rig.bones[side+'_thigh'].quaternion.slerp(releasePose.thigh,alpha);
 v.rig.bones[side+'_shin'].quaternion.slerp(releasePose.shin,alpha);
 v.root.updateWorldMatrix(true,true);
};
const reset=()=>{side=null;previousTime=null;awaitingOpposite=null;lastCorrected=null;releasePose=null;};
 return {reset,get supportSide(){return side;},get targetWorld(){return side?locked.clone():null;},apply(
  v:Pick<ChibiVisitor,'root'|'rig'> & {translatePose?:(delta:T.Vector3)=>void},time:number,speed:number,walking=true,forcedSide:'L'|'R'|null=null
 ){
  if(!walking||!v.rig||!Number.isFinite(time)||!Number.isFinite(speed)||speed<=0){reset();return;}
  v.root.updateWorldMatrix(true,true);
  const root=v.root.getWorldPosition(new T.Vector3());
const dt=previousTime===null?0:time-previousTime;
if(forcedSide){lastCorrected=null;releasePose=null;}
  // A furniture clip may sample the same timestamp more than once while
  // drawing/reducing motion; re-sampling must never discard a planted toe.
  if(previousTime!==null&&((forcedSide?dt<-.0001:dt<=0)||dt>.35||root.distanceTo(previousRoot)>Math.max(.22,3*speed*Math.max(0,dt))))reset();
  previousRoot.copy(root);previousTime=time;
  const toes={L:v.rig.bones.L_toe.getWorldPosition(new T.Vector3()),R:v.rig.bones.R_toe.getWorldPosition(new T.Vector3())};
  const candidate:'L'|'R'=forcedSide??(toes.L.y<=toes.R.y?'L':'R');
  const toeScale=v.rig.bones.L_toe.getWorldScale(new T.Vector3()).x;
  const hysteresis=Math.max(.008,Math.abs(toeScale)*.012);
  const swingClearance=Math.max(.025,Math.abs(toeScale)*.035);
  const floor=Math.min(toes.L.y,toes.R.y);
  const other=side==='L'?'R':'L';
  // A planted toe is not allowed to drag the entire pelvis into its swing.
  // During walking, release on toe rise or after crossing the stance reach.
  if(!forcedSide&&side){
   const hip=v.rig.bones[side+'_thigh'].getWorldPosition(new T.Vector3());
   const knee=v.rig.bones[side+'_shin'].getWorldPosition(new T.Vector3());
   const ankle=v.rig.bones[side+'_foot'].getWorldPosition(new T.Vector3());
   const reach=hip.distanceTo(knee)+knee.distanceTo(ankle);
   const rising=toes[side].y>floor+swingClearance;
   const pastStance=root.distanceTo(lockRoot)>Math.max(.19,reach*.43);
   if(rising||pastStance&&toes[other].y<=floor+swingClearance){
beginRelease(time,side);awaitingOpposite=side;side=null;
   }
  }
  if(side===null){
   // After a released stance, prefer a physically grounded opposite foot;
   // re-planted old toes must not masquerade as a fresh step.
   if(!forcedSide&&candidate===awaitingOpposite){
    const landing=awaitingOpposite==='L'?'R':'L';
if(toes[landing].y>floor+swingClearance){fadeRelease(v,time);return;}
    side=landing;
   }else side=candidate;
awaitingOpposite=null;locked.copy(toes[side]);lockRoot.copy(root);fadeRelease(v,time);return;
  }
  if(forcedSide?side!==forcedSide:toes[other].y+hysteresis<toes[side].y){
if(!forcedSide)beginRelease(time,side);
side=forcedSide??other;awaitingOpposite=null;locked.copy(toes[side]);lockRoot.copy(root);fadeRelease(v,time);return;
  }
  // Joint origins measure actual limb lengths, not scaled hip offsets.
  const hip=v.rig.bones[side+'_thigh'].getWorldPosition(new T.Vector3());
  const knee=v.rig.bones[side+'_shin'].getWorldPosition(new T.Vector3());
  const ankle=v.rig.bones[side+'_foot'].getWorldPosition(new T.Vector3());
  const reach=hip.distanceTo(knee)+knee.distanceTo(ankle);
  // A deliberately planted furniture foot must not silently re-anchor after
  // a deep knee bend. Only ordinary walk clips may change their stance target
  // at the shorter swing-foot threshold. Unreachable contacts remain for the
  // caller's safety gate to reject rather than presenting a false foot lock.
  if(locked.distanceTo(toes[side])>Math.max(forcedSide?.22:.18,reach*(forcedSide?.88:.6))){
   // An unreachable planted target cannot silently follow a swinging toe.
if(!forcedSide){beginRelease(time,side);awaitingOpposite=side;side=null;}
fadeRelease(v,time);
   return;
  }
  // Walking needs stronger convergence than one-shot head/seat adjustments.
  // Fixed bone lengths; only the existing thigh and shin rotate.
  settleLegContact(v,side,locked,.95,{iterations:forcedSide?8:6,maxAngle:forcedSide?.11:.12,maxTotalAngle:forcedSide?.65:undefined});
  // IK cannot correct an unreachable toe by bending knees alone. A bounded
  // pelvis-layer counter-shift carries the remaining stance error without
  // moving the navigation root or stretching any bone. The authored base pose
  // is restored on each animation sample; this correction has no stored drift.
  if(v.translatePose){
   const actual=v.rig.bones[side+'_toe'].getWorldPosition(new T.Vector3());
   const residual=locked.clone().sub(actual);
   if(residual.lengthSq()>.000025){
    // A large lateral pelvis pull caused visible dashes at foot transitions.
    // Leave the main stance correction to knee IK and cap this residual.
    const hipStep=residual.multiplyScalar(.52).clampLength(0,.020);
    v.translatePose(hipStep);
   }
  }
lastCorrected={side,thigh:v.rig.bones[side+'_thigh'].quaternion.clone(),shin:v.rig.bones[side+'_shin'].quaternion.clone()};
fadeRelease(v,time);
 }};
}
