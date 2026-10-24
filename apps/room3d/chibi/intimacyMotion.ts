import {poseSeatedHug} from './seatedHug';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver} from './socialContact';
import {poseHug} from './hugMotion';
import {settleLegContact} from './legContactIK';
import {lipWorld,aimLipContact} from './headContactIK';

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
   // Avoid switching roles or lifting feet for almost equal-height partners.
   const difference=Math.max(0,gap-.035);
   const rise=T.MathUtils.clamp(difference*.32,0,.18)*heightBlend;
   const bend=T.MathUtils.clamp((difference-rise)*.55,0,.25)*heightBlend;
   // Record both residents' original contact planes before modifying legs.
   const groundOf=(v:ChibiVisitor)=>{v.root.updateWorldMatrix(true,true);return Math.min(...(['L_toe','R_toe','L_foot','R_foot'] as const).map(n=>v.rig!.bones[n].getWorldPosition(new T.Vector3()).y));};
   const tallerGround=groundOf(taller);
   shorter.root.updateWorldMatrix(true,true);
   const toeBefore=['L_toe','R_toe'].map(n=>shorter.rig!.bones[n].getWorldPosition(new T.Vector3()));
   for(const side of ['L','R'] as const){
    const foot=shorter.rig!.bones[side+'_foot'];
    const toe=shorter.rig!.bones[side+'_toe'];
    const base=foot.quaternion.clone();
    // Foot forward-axis differs between rigs; choose the direction that
    // raises the heel relative to the toe in world space.
    const angle=T.MathUtils.clamp(rise*1.8,0,.32);
    foot.quaternion.copy(base).multiply(rotation(angle));
    shorter.root.updateWorldMatrix(true,true);
    const plus=foot.getWorldPosition(new T.Vector3()).y-toe.getWorldPosition(new T.Vector3()).y;
    foot.quaternion.copy(base).multiply(rotation(-angle));
    shorter.root.updateWorldMatrix(true,true);
    const minus=foot.getWorldPosition(new T.Vector3()).y-toe.getWorldPosition(new T.Vector3()).y;
    foot.quaternion.copy(base).multiply(rotation(plus>=minus?angle:-angle));
    // The correction below keeps the toe on its original contact plane.
    taller.rig!.bones[side+'_thigh'].quaternion.multiply(rotation(-bend*1.8));
    taller.rig!.bones[side+'_shin'].quaternion.multiply(rotation(bend*3.1));
    taller.rig!.bones[side+'_foot'].quaternion.multiply(rotation(-bend*1.3));
   }
   shorter.root.updateWorldMatrix(true,true);
   const toeAfter=['L_toe','R_toe'].map(n=>shorter.rig!.bones[n].getWorldPosition(new T.Vector3()));
   // Keep each toe near its pre-pose contact point while allowing the heel
   // to rise. The short CCD chain shares the adjustment with shin and thigh.
   if(rise>.002)for(const side of ['L','R'] as const){
    const index=side==='L'?0:1;
    settleLegContact(shorter,side,toeBefore[index],heightBlend);
   }
   // Preserve the lowest planted toe rather than averaging both feet:
   // averaging can leave one foot penetrating the floor.
   const beforeFloor=Math.min(...toeBefore.map(p=>p.y));
   const afterFloor=Math.min(...toeAfter.map(p=>p.y));
   const correction=T.MathUtils.clamp(beforeFloor-afterFloor,-.12,.12);
   shorter.translatePose(new T.Vector3(0,correction,0));
   taller.rig!.bones.spine.quaternion.multiply(rotation(bend*.9));
   taller.rig!.bones.chest.quaternion.multiply(rotation(bend*1.05));
   taller.rig!.bones.neck.quaternion.multiply(rotation(bend*.45));
   // Knee flexion can lower the sole below the floor. Restore the taller
   // resident's original contact plane without moving the navigation root.
   const tallerCorrection=T.MathUtils.clamp(tallerGround-groundOf(taller),-.12,.12);
   if(Math.abs(tallerCorrection)>1e-5)taller.translatePose(new T.Vector3(0,tallerCorrection,0));
   a.root.updateWorldMatrix(true,true);
   b.root.updateWorldMatrix(true,true);
  }
  // Re-evaluate approximate lip anchors after the height correction.
  // A shared midpoint is a target, not a forced head translation.
  const lipA=lipWorld(a),lipB=lipWorld(b);
  const shared=lipA.clone().add(lipB).multiplyScalar(.5);
  const lipGap=lipA.distanceTo(lipB);
  const contactWeight=gaze*T.MathUtils.clamp((.9-lipGap)/.5,0,1);
  if(contactWeight>0){
   aimLipContact(a,shared,contactWeight);
   aimLipContact(b,shared,contactWeight);
  }
  // Preserve the small opposite head tilts from the original kiss pose.
  a.rig.bones.head.quaternion.multiply(rotation(0,0,-.055*kiss));
  b.rig.bones.head.quaternion.multiply(rotation(0,0,.055*kiss));
  a.root.updateWorldMatrix(true,true);
  b.root.updateWorldMatrix(true,true);
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
