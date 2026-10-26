import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {faceContactWorld} from './faceContactProfiles';
import {settleLegContact} from './legContactIK';
import {headPatScalpSize} from './headPatMotion';
import type {ActionExpression} from './actionExpression';

export const SNEAK_KISS_ID='home-sneak-kiss';
export const SNEAK_KISS_SECONDS=5;
const smooth=T.MathUtils.smootherstep;
const fade=(t:number,a:number,b:number,c:number,d:number)=>smooth(t,a,b)*(1-smooth(t,c,d));
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));
const up=new T.Vector3(0,1,0);
export function sneakKissPhase(time:number){
 const t=T.MathUtils.clamp(time,0,5);
 const lead=fade(t,.18,.72,2.72,3.12),trail=fade(t,.72,1.35,2.32,2.72);
 return {
  step:(lead+trail)/2,lead,trail,
  prepare:fade(t,.45,1.80,2.15,2.95),
  receiverAdjust:fade(t,0,1.40,2.45,4.20),
  kiss:fade(t,1.45,1.85,2.15,2.45),
  away:fade(t,0,.55,2.35,2.85),
  reaction:fade(t,2.35,2.90,4.45,5),
  smug:fade(t,2.65,3.25,4.40,5),
  sway:Math.sin(Math.PI*2*smooth(t,3.45,4.45))*fade(t,3.45,3.65,4.20,4.45),
 };
}
export function sneakKissExpression(actor:0|1,time:number):ActionExpression{
 if(time>=5)return 'neutral';
 if(actor===0)return time>.35?'smiling':'neutral';
 return time<2.15?'neutral':time<2.85?'surprised':'smiling';
}
export type SneakKissPlan={
 side:1|-1;heading:T.Quaternion;stance:T.Vector3;step:T.Vector3;
 knee:number;toe:number;pitch:number;receiverKnee:number;receiverBow:number;
 error:number;surfaceValid:boolean;cheek:T.Vector3;mouth:T.Vector3;
};
const toes=(v:ChibiVisitor)=>['L','R'].map(s=>v.rig!.bones[s+'_toe'].getWorldPosition(new T.Vector3()));

/** Temporary articulated height adjustment, shared by either participant.
 * Ankle/toe articulation raises the heels; vertical translation is only the
 * measured correction needed to keep the original toe contacts on the floor.
 */
function groundedPose(a:ChibiVisitor,knee:number,toe:number,pitch:number,prepare:number,kiss:number,bow=.16){
 const bones=a.rig!.bones;
 a.root.updateWorldMatrix(true,true);const planted=toes(a);
 for(const side of ['L','R']){
  bones[side+'_thigh'].quaternion.multiply(q(-knee*prepare));
  bones[side+'_shin'].quaternion.multiply(q(2*knee*prepare));
  bones[side+'_foot'].quaternion.multiply(q((-knee+toe)*prepare));
 }
 bones.spine.quaternion.multiply(q(bow*.625*kiss));
 bones.chest.quaternion.multiply(q(bow*.375*kiss));
 bones.head.quaternion.multiply(q(pitch*prepare));
 a.root.updateWorldMatrix(true,true);
 const posed=toes(a);
 const correction=planted[0].sub(posed[0]).add(planted[1].sub(posed[1])).multiplyScalar(.5);
 a.translatePose(correction);
}

/** Build one endpoint before navigation, using the real face anchors and the
 * actual skeleton scale. No per-frame head chase and no neck/bone translation.
 * Caller starts from standing idle; all trial poses/root rotations are restored.
 */
export function planSneakKiss(a:ChibiVisitor,b:ChibiVisitor,side:1|-1):SneakKissPlan{
 const oldQ=a.root.quaternion.clone();
 a.animate(0,'idle');b.animate(0,'idle');
 // Existing anatomical landmarks locate the feature; project onto the actual
 // skinned surface so a flat face anchor cannot hide inside a large head.
 const mouthSeed=faceContactWorld(a,'mouth')!;
 const faceForward=new T.Vector3(0,0,1).applyQuaternion(a.rig!.bones.head.getWorldQuaternion(new T.Quaternion()));
 a.root.updateMatrixWorld(true);a.rig!.skeleton.update();a.rig!.mesh.boundingSphere=null;a.rig!.mesh.boundingBox=null;
 const mouthHit=new T.Raycaster(mouthSeed.clone().addScaledVector(faceForward,1),faceForward.clone().negate(),0,2).intersectObject(a.rig!.mesh,false)[0];
 const mouthLocal=a.rig!.bones.head.worldToLocal(mouthHit?.point.clone()??mouthSeed);
 b.rig!.bones.head.quaternion.multiply(q(0,-side*.18));
 b.root.updateWorldMatrix(true,true);
 const target=faceContactWorld(b,side>0?'rightCheek':'leftCheek')!;
 // The lower lateral cheek is still a cheek, and avoids forcing a shorter
 // actor to aim at the eye line. Resolve its actual skin surface once.
 const mouthB=faceContactWorld(b,'mouth')!;
 target.y=T.MathUtils.lerp(target.y,mouthB.y,.70);
 const normal=new T.Vector3(side*.73,0,.68).applyQuaternion(b.rig!.bones.head.getWorldQuaternion(new T.Quaternion())).normalize();
 b.root.updateMatrixWorld(true);b.rig!.skeleton.update();b.rig!.mesh.boundingSphere=null;b.rig!.mesh.boundingBox=null;
 const ray=new T.Raycaster(target.clone().addScaledVector(normal,1),normal.clone().negate(),0,2);
 const hit=ray.intersectObject(b.rig!.mesh,false)[0];
 if(hit)target.copy(hit.point);
 const cheek=b.rig!.bones.head.worldToLocal(target.clone());
 // Solve the pair's contact height, not whether a fixed A-only clip fits.
 // A uses a modest toe/upper-body reach. When B is much taller, B lowers
 // through knees and a small forward bow while still looking elsewhere.
 // This is pose articulation only: no stature, scale or bind-position changes.
 let heading=new T.Quaternion();
 const trial=(knee:number,toe:number,pitch:number,receiverKnee=0)=>{
  b.animate(0,'idle');
  groundedPose(b,receiverKnee,0,0,1,1,receiverKnee*.28);
  b.rig!.bones.head.quaternion.multiply(q(0,-side*.18));
  b.root.updateWorldMatrix(true,true);
  normal.set(side*.73,0,.68).applyQuaternion(b.rig!.bones.head.getWorldQuaternion(new T.Quaternion())).normalize();
  target.copy(b.rig!.bones.head.localToWorld(cheek.clone())).addScaledVector(normal,.012);
  heading.setFromAxisAngle(up,Math.atan2(-normal.x,-normal.z));
  a.root.quaternion.copy(heading);
  a.animate(0,'idle');groundedPose(a,knee,toe,pitch,1,1);
  return a.rig!.bones.head.localToWorld(mouthLocal.clone());
 };
 let knee=0,toe=0,pitch=-.18,receiverKnee=0;
 const initial=trial(0,0,pitch).y-target.y;
 if(initial>0){
  let lo=0,hi=1.45;
  for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(trial(mid,0,pitch).y>target.y)lo=mid;else hi=mid;}
  knee=(lo+hi)/2;
 }else{
  // Keep the short actor's chin/ankles comfortable instead of exhausting
  // their range, then rejecting even ordinary differences in character height.
  let lo=0,hi=1;
  for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(trial(0,.38*mid,-.18-.16*mid).y<target.y)lo=mid;else hi=mid;}
  const amount=(lo+hi)/2;toe=.38*amount;pitch=-.18-.16*amount;
  if(trial(0,toe,pitch).y<target.y){
   lo=0;hi=1.45;
   for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(trial(0,toe,pitch,mid).y<target.y)lo=mid;else hi=mid;}
   receiverKnee=(lo+hi)/2;
  }
 }
 const mouth=trial(knee,toe,pitch,receiverKnee),error=Math.abs(mouth.y-target.y);
 const contactRoot=a.root.position.clone().add(target.clone().sub(mouth).setY(0));
 const step=normal.clone().setY(0).normalize().multiplyScalar(-.20);
 const stance=contactRoot.sub(step);
 a.root.quaternion.copy(oldQ);a.animate(0,'idle');b.animate(0,'idle');
 return {side,heading,stance,step,knee,toe,pitch,receiverKnee,receiverBow:receiverKnee*.28,
  error,surfaceValid:!!mouthHit&&!!hit,cheek,mouth:mouthLocal};
}

export function poseSneakKiss(a:ChibiVisitor,b:ChibiVisitor,time:number,plan:SneakKissPlan){
 if(!a.rig||!b.rig)return;
 const p=sneakKissPhase(time),ar=a.rig.bones,br=b.rig.bones;
 groundedPose(b,plan.receiverKnee,0,0,p.receiverAdjust,p.receiverAdjust,plan.receiverBow);
 groundedPose(a,plan.knee,plan.toe,plan.pitch,p.prepare,p.kiss);
 // The small approach is two alternating foot placements, not sliding a
 // standing skeleton over the floor. Both feet settle before the quick kiss.
 const current=toes(a);
 for(const [i,side] of (['L','R'] as const).entries()){
  const progress=i===0?p.lead:p.trail;
  const target=current[i].clone().addScaledVector(plan.step,progress-p.step);
  target.y+=Math.sin(Math.PI*progress)*.055;
  for(let pass=0;pass<4;pass++)settleLegContact(a,side,target,1);
 }
 // Look away throughout the kiss. Reaction starts only after withdrawal.
 br.head.quaternion.multiply(q(0,-plan.side*.18*p.away+plan.side*.58*p.reaction,plan.side*.025*p.reaction));
 br.spine.quaternion.multiply(q(0,plan.side*.12*p.reaction));
 br.chest.quaternion.multiply(q(0,plan.side*.10*p.reaction));
 // One shy shoulder shrug, a hand behind the back and a small grounded sway.
 ar.head.quaternion.multiply(q(0,.06*p.smug,-.12*p.smug));
 ar.spine.quaternion.multiply(q(0,0,.025*p.sway));
 for(const side of ['L','R'])ar[side+'_clavicle'].quaternion.multiply(q(0,0,(side==='L'?1:-1)*.09*p.smug));
 ar.R_upperArm.quaternion.slerp(q(.42,0,1.12),p.smug);
 ar.R_forearm.quaternion.slerp(q(0,.85,.15),p.smug);
 a.root.updateWorldMatrix(true,true);b.root.updateWorldMatrix(true,true);
}

/** Reuse room navigation for each leg, with a head-sized exclusion around B.
 * The room map excludes the participating pair so contact is possible; it
 * cannot by itself stop A's approach path from cutting through B's head.
 */
export function planSneakKissApproach(start:T.Vector3,goal:T.Vector3,b:ChibiVisitor,a:ChibiVisitor,
 find:(from:T.Vector3,to:T.Vector3)=>T.Vector3[]|null):T.Vector3[]|null{
 const center=b.root.position;
 const distance=(p:T.Vector3)=>Math.hypot(p.x-center.x,p.z-center.z);
 const radius=Math.max(0,Math.min(headPatScalpSize(a).radius+headPatScalpSize(b).radius+.08,distance(start)-.01,distance(goal)-.01));
 const safe=(path:T.Vector3[]|null)=>{
  if(!path||path.length<2)return false;
  for(let i=1;i<path.length;i++){
   const p=path[i-1],d=path[i].clone().sub(p).setY(0);
   const t=T.MathUtils.clamp(new T.Vector3().subVectors(center,p).setY(0).dot(d)/(d.lengthSq()||1),0,1);
   if(distance(p.clone().addScaledVector(d,t))<radius-1e-5)return false;
  }
  return true;
 };
 const direct=find(start,goal);if(safe(direct))return direct;
 const startAngle=Math.atan2(start.x-center.x,start.z-center.z),endAngle=Math.atan2(goal.x-center.x,goal.z-center.z);
 const clockwise=T.MathUtils.euclideanModulo(endAngle-startAngle,Math.PI*2);
 const candidates:T.Vector3[][]=[];
 for(const angle of [clockwise,clockwise-Math.PI*2]){
  const count=Math.max(1,Math.ceil(Math.abs(angle)/(.25*Math.PI))),ring=radius+.12;
  const checkpoints=Array.from({length:count+1},(_,i)=>{
   const theta=startAngle+angle*i/count;
   return new T.Vector3(center.x+Math.sin(theta)*ring,start.y,center.z+Math.cos(theta)*ring);
  });checkpoints.push(goal);
  let from=start,path=[start.clone()],valid=true;
  for(const point of checkpoints){const leg=find(from,point);if(!safe(leg)){valid=false;break;}path.push(...leg!.slice(1));from=point;}
  if(valid)candidates.push(path);
 }
 const length=(path:T.Vector3[])=>path.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(path[i]),0);
 candidates.sort((a,b)=>length(a)-length(b));return candidates[0]??null;
}
