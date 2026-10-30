import * as T from 'three';
import {CCDIKSolver} from 'three/examples/jsm/animation/CCDIKSolver.js';
import {BLANK_SCALE} from './blankBody';
import {constrainForearmTwist} from '../../../experiments/chibi/forearmTwist';
import type {bindBlankBody} from './blankRig';
import type {ActivityPose} from './types';

export function bathroomFrame(time:number){
 const s=T.MathUtils.smootherstep,t=Math.max(0,time);
 return {wash:s(t,.3,1.2)*(1-s(t,9.8,11.5)),press:s(t,.3,1.1)*(1-s(t,2.6,3.3)),breathe:Math.sin(t*1.6)};
}
/** Once both feet are inboard, let the unsupported outer-rim grip become
 * a relaxed, chest-local bath hand rest instead of dropping through the tub.
 * This is a target blend, never a second navigation/root or skeleton owner. */
export function bathInnerHandWeight(seatWeight:number,support:number,phase?:string){
 if(phase==='work')return 1;
 return T.MathUtils.smootherstep(T.MathUtils.clamp(seatWeight,0,1),.20,.88)
  *(1-T.MathUtils.clamp(support,0,1));
}

/** Furniture contact and head-relative palms reuse the existing Three IK solver. */
export function createBathroomContact(rig:ReturnType<typeof bindBlankBody>,body:T.Group){
 const goals=[new T.Bone(),new T.Bone()],bones=[...rig.skeleton.bones,...goals],index=(n:string)=>bones.indexOf(rig.bones[n]);
 const chains=['L','R'].map((s,i)=>({target:rig.skeleton.bones.length+i,effector:index(s+'_hand'),iteration:30,maxAngle:.12,links:[{index:index(s+'_forearm')},{index:index(s+'_upperArm')}]}));
 const solver=new CCDIKSolver({skeleton:{bones}} as T.SkinnedMesh,chains),point=new T.Vector3(),restPoint=new T.Vector3(),rotation=new T.Quaternion(),parentQ=new T.Quaternion();
 const pose=Object.fromEntries(Object.keys(rig.bones).map(n=>[n,new T.Quaternion()]));
 const shoulder=new T.Vector3(),elbow=new T.Vector3(),wrist=new T.Vector3();
 return (time:number,a:ActivityPose)=>{
  if(!a.kind.startsWith('bath-')||a.bathPhase&&a.bathPhase!=='work'&&a.kind!=='bath-soak'||!body.parent)return;
  const f=bathroomFrame(time);body.updateWorldMatrix(true,true);
  for(const [i,side,sign] of [[0,'L',1],[1,'R',-1]] as const){
   let weight=0;
   if(a.kind==='bath-shower'){
    // Palms beside the hair, alternating small rubs; no hands through the face.
    point.set(sign*.16*BLANK_SCALE,(.095+Math.sin(time*3+i*Math.PI)*.01)*BLANK_SCALE,.04*BLANK_SCALE);
    rig.bones.head.localToWorld(point);weight=f.wash;
   }else if(a.kind==='bath-soak'&&a.bathHands?.[i]){
    point.fromArray(a.bathHands[i]).multiplyScalar(a.handScale??1);body.parent.localToWorld(point);
    const hold=a.bathPhase==='work'?0:T.MathUtils.clamp(a.bathSupport??0,0,1);
    const rest=bathInnerHandWeight(a.seatWeight??0,hold,a.bathPhase);
    if(rest>0){
     // Both hands fold inward above the seated body, not outside the GLB wall.
     // Use the real torso bone so body scale and the entire inboard turn are
     // inherited automatically; never move or stretch the arm skeleton.
     restPoint.set(sign*.11*BLANK_SCALE,-.12*BLANK_SCALE,.075*BLANK_SCALE);
     rig.bones.chest.localToWorld(restPoint);
     point.lerp(restPoint,rest/(rest+hold));
    }
    weight=Math.max(hold,rest);
   }else if(a.kind==='bath-laundry'&&side==='R'&&a.bathHands?.[0]){
    point.fromArray(a.bathHands[0]);point.z+=Math.sin(time*8)*.012*f.press;
    point.multiplyScalar(a.handScale??1);body.parent.localToWorld(point);weight=f.press;
   }
   if(!weight)continue;
   if(a.kind==='bath-soak'){
    // World-space authored rim goals may be unreachable for a short or wide
    // character; never let CCD contort the shoulder toward a moving phantom.
    const upper=rig.bones[side+'_upperArm'],forearm=rig.bones[side+'_forearm'],end=rig.bones[side+'_hand'];
    upper.getWorldPosition(shoulder);forearm.getWorldPosition(elbow);end.getWorldPosition(wrist);
    const reach=shoulder.distanceTo(elbow)+elbow.distanceTo(wrist);
    if(!Number.isFinite(reach)||shoulder.distanceTo(point)>reach*1.10)continue;
   }
   const hand=rig.bones[side+'_hand'];hand.getWorldQuaternion(rotation);
   goals[i].matrixWorld.makeTranslation(point.x,point.y,point.z);solver.updateOne(chains[i],weight);
   // Keep the authored wrist orientation while the elbow solves the contact.
   hand.parent!.getWorldQuaternion(parentQ);hand.quaternion.copy(parentQ.invert().multiply(rotation));
   rig.setHandCurl(side,a.kind==='bath-laundry'?.22:.08);
   for(const [name,bone]of Object.entries(rig.bones))pose[name].copy(bone.quaternion);
   constrainForearmTwist(rig,pose,side);for(const suffix of ['twist1','twist2','twist3'])rig.bones[side+'_'+suffix]?.quaternion.copy(pose[side+'_'+suffix]);
   body.updateWorldMatrix(true,true);
  }
 };
}
