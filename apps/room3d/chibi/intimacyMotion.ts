import {poseSeatedHug} from './seatedHug';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver} from './socialContact';
import {poseHug} from './hugMotion';

type Resident={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
const smooth=T.MathUtils.smootherstep;
const rotation=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
export const isPrincessCarry=(id:string)=>id==='home-princess-carry'||id==='home-princess-carried';
export const isIntimacy=(id:string)=>id==='home-hug'||id==='home-kiss'||isPrincessCarry(id);
/** Reference-video phases, in elapsed seconds; neither role owns a separate clock. */
export function intimacyPhase(action:string,time:number){
 const carry=isPrincessCarry(action);
 return {
  contact:smooth(time,.3,carry?1.8:2)*(1-smooth(time,7.5,9.6)),
  lift:carry?smooth(time,2,3.8)*(1-smooth(time,6.7,8.8)):0,
  crouch:carry?(smooth(time,.5,1.7)*(1-smooth(time,2,3.5))+smooth(time,6.5,7.7)*(1-smooth(time,8.2,9.5)))*.48:0,
 };
}
/** Pose only: called after idle reset; translations live under the navigation root. */
export function poseIntimacy(action:string,both:Resident[],time:number,seatedIndex?:number){
 const [a,b]=both.map(r=>r.visitor),p=intimacyPhase(action,time);
 if(!a.rig||!b.rig)return;
 if(action==='home-hug'){if(seatedIndex===0||seatedIndex===1)poseSeatedHug(both,time,seatedIndex);else poseHug(both,time);return;}
 if(action==='home-kiss'){
  // First meet eyes, then slowly align heads; maintain the kiss before easing away.
  const hands=smooth(time,1.65,3.1)*(1-smooth(time,10.5,12));
  const gaze=smooth(time,2.1,3.5)*(1-smooth(time,10.4,12));
  const kiss=smooth(time,4.2,5.4)*(1-smooth(time,9,10.7));
  const heads=both.map(r=>r.visitor.getHeadWorldPosition());
  // Aim the face at the partner instead of applying the same downward nod
  // to both residents. Height correction below happens before final aiming.
  // Adjust the kiss pose using the partners' actual head heights.
  // The shorter resident rises on their toes; the taller resident bends
  // slightly at the knees and waist. Both movements ease in and out.
  const heightBlend=smooth(time,3.45,5.15)*(1-smooth(time,9.1,11.25));
  if(heightBlend>0){
   const shorter=heads[0].y<=heads[1].y?a:b;
   const taller=shorter===a?b:a;
   const gap=Math.abs(heads[0].y-heads[1].y);
   const rise=T.MathUtils.clamp(gap*.32,0,.18)*heightBlend;
   const bend=T.MathUtils.clamp((gap-rise)*.55,0,.25)*heightBlend;
   for(const side of ['L','R'] as const){
    shorter.rig!.bones[side+'_foot'].quaternion.multiply(rotation(-rise*1.3));
    taller.rig!.bones[side+'_thigh'].quaternion.multiply(rotation(-bend*1.8));
    taller.rig!.bones[side+'_shin'].quaternion.multiply(rotation(bend*3.1));
    taller.rig!.bones[side+'_foot'].quaternion.multiply(rotation(-bend*1.3));
   }
   shorter.translatePose(new T.Vector3(0,rise,0));
   taller.rig!.bones.spine.quaternion.multiply(rotation(bend*.65));
   taller.rig!.bones.chest.quaternion.multiply(rotation(bend*.75));
   taller.rig!.bones.neck.quaternion.multiply(rotation(bend*.45));
   a.root.updateWorldMatrix(true,true);
   b.root.updateWorldMatrix(true,true);
  }
  // Recompute the faces after height correction. The head-local +Z axis is
  // the face's forward direction in the home rig; pitch is opposite for
  // partners at different heights, so neither character blindly nods down.
  const faces=both.map(r=>{
   const v=r.visitor;
   v.root.updateWorldMatrix(true,true);
   return v.rig!.bones.head.localToWorld(new T.Vector3(0,.59,.17));
  });
  both.forEach((owner,i)=>{
   const v=owner.visitor,other=faces[1-i],here=faces[i];
   const delta=other.clone().sub(here);
   const horizontal=Math.max(.35,Math.hypot(delta.x,delta.z));
   const pitch=T.MathUtils.clamp(Math.atan2(delta.y,horizontal),-.26,.26);
   const tilt=(i===0?-.055:.055)*kiss;
   v.rig!.bones.neck.quaternion.multiply(rotation(-pitch*gaze*.48,0,tilt*.35));
   v.rig!.bones.head.quaternion.multiply(rotation(-pitch*gaze*.52,0,tilt));
   v.root.updateWorldMatrix(true,true);
  });
  // Solve a shared hand contact after both heads have settled.
  const sides=['R','L'] as const;
  const handA=a.rig.bones.R_hand.getWorldPosition(new T.Vector3());
  const handB=b.rig.bones.L_hand.getWorldPosition(new T.Vector3());
  const target=handA.add(handB).multiplyScalar(.5);
  both.forEach((owner,i)=>{
   const side=sides[i],v=owner.visitor;
   owner.solver?.({side,point:target,direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(v.root.quaternion),normal:new T.Vector3(0,1,0),curl:.2},hands);
  });
  return;
 }

 const turn=(v:ChibiVisitor,n:string,q:T.Quaternion,w:number)=>v.rig!.bones[n].quaternion.slerp(q,w);
 const point=(v:ChibiVisitor,n:string,offset=[0,0,0])=>v.rig!.bones[n].localToWorld(new T.Vector3(...offset));
 const contact=(index:number,side:'L'|'R',target:T.Vector3,curl=.18)=>{
  const facing=both[index].visitor.root.getWorldQuaternion(new T.Quaternion());
  both[index].solver?.({side,point:target,direction:new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(facing),normal:new T.Vector3(0,1,0).applyQuaternion(facing),curl},p.contact);
 };
 const sole=()=>Math.min(...['L_toe','R_toe','L_foot','R_foot'].map(n=>point(a,n).y));
 const standingSole=sole();
 for(const side of ['L','R'] as const){
  turn(a,side+'_thigh',rotation(-p.crouch,0,(side==='L'?-.05:.05)*p.contact),1);
  turn(a,side+'_shin',rotation(p.crouch*2),1);
  turn(a,side+'_foot',rotation(-p.crouch),1);
 }
 a.root.updateWorldMatrix(true,true);a.translatePose(new T.Vector3(0,standingSole-sole(),0));
 // The recipient turns across the carrier, folds both knees, then rises into the arms.
 turn(b,'hips',rotation(0,Math.PI/2,0).multiply(rotation(-.45)),p.lift);
 for(const side of ['L','R'] as const){
  turn(b,side+'_thigh',rotation(-1.35,0,side==='L'?-.025:.025),p.lift);
  turn(b,side+'_shin',rotation(1.45),p.lift);
  turn(b,side+'_foot',rotation(.12),p.lift);
 }
 b.root.updateWorldMatrix(true,true);
 const target=point(a,'hips',[.25,.58,.86]);
 b.translatePose(target.sub(point(b,'hips')).multiplyScalar(p.lift));
 for(const side of ['L','R'] as const){
  turn(a,side+'_upperArm',rotation(-.15,side==='L'?-.6:.6,side==='L'?-.8:.8),p.contact);
  turn(b,side+'_upperArm',rotation(-.2,side==='L'?-.6:.6,side==='L'?-.6:.6),p.contact);
 }
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
 contact(0,'L',point(b,'spine',[0,.10,-.16]),.3);
 contact(0,'R',point(b,'R_shin',[0,.08,-.10]),.3);
 contact(1,'L',point(a,'R_upperArm',[0,.07,-.10]));
 contact(1,'R',point(a,'L_upperArm',[0,.02,-.12]));
}
