import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver} from './socialContact';
import type {HeadTouchRecipe} from './motionTemplates';

/**
 * One reusable, deterministic pattern. Source JSON contains only two static
 * root tracks: the shared player handles approaching, room checks and timing.
 * This module only adds hand/head posture after the standard base pose.
 * No new IK solver, animation loop, physics engine, or per-frame clip scan.
 */
export const HEAD_PAT_TIMING=Object.freeze({
 patStart:1.10,
 patEnd:3.10,
 ruffleStart:3.70,
 ruffleEnd:6.28,
 releaseEnd:7.18,
});
const smooth=T.MathUtils.smootherstep;
const saturate=(v:number)=>T.MathUtils.clamp(v,0,1);
const pulse=(time:number,start:number,end:number,count:number)=>{
 if(time<=start||time>=end)return 0;
 return Math.sin(Math.PI*count*(time-start)/(end-start))**2;
};
export function headPatTimeline(time:number,recipe:HeadTouchRecipe){
 const t=Number.isFinite(time)?Math.max(0,time):0;
 const {patStart,patEnd,ruffleStart,ruffleEnd,releaseEnd}=HEAD_PAT_TIMING;
 const single=smooth(t,.42,1.05)*(1-smooth(t,6.38,releaseEnd));
 const double=smooth(t,3.15,ruffleStart)*(1-smooth(t,6.38,releaseEnd));
 const rub=smooth(t,ruffleStart-.12,ruffleStart+.12)*(1-smooth(t,ruffleEnd-.1,ruffleEnd+.23));
 const progress=saturate((t-ruffleStart)/(ruffleEnd-ruffleStart));
 const angle=progress*2*Math.PI*recipe.ruffleStrokes;
 return {
  time:t,
  single,double,rub,
  patPulse:pulse(t,patStart,patEnd,recipe.patStrokes),
  rubX:Math.sin(angle)*rub,
  rubZ:Math.cos(angle)*rub,
  surprised:smooth(t,3.77,4.14)*(1-smooth(t,6.8,7.34)),
 };
}
type Resident={
 visitor:ChibiVisitor;
 solver:ReturnType<typeof contactSolver>;
};

/** Plan both hands in the GIVER's left/right lanes, not in the opposing
 * receiver head bone's X axis. This prevents hand crossing when characters
 * face one another and when the head turns during the playful reaction.
 * Both arms use the same measured scalp surface and one owner->target axis.
 */
export function headPatHandGoal(
 actor:ChibiVisitor,recipient:ChibiVisitor,side:'L'|'R',
 crown:T.Vector3,headUp:T.Vector3,span:number,
 time:ReturnType<typeof headPatTimeline>,ruffle:boolean
){
 actor.root.updateWorldMatrix(true,true);
 const up=new T.Vector3(0,1,0);
 const forward=crown.clone().sub(actor.root.getWorldPosition(new T.Vector3())).setY(0);
 if(forward.lengthSq()<1e-6)forward.set(0,0,1).applyQuaternion(actor.root.getWorldQuaternion(new T.Quaternion())).setY(0);
 forward.normalize();
 const lateral=new T.Vector3().crossVectors(up,forward).normalize();
 const sign=side==='L'?1:-1;
 // Never cross the central scalp line. Left and right touch targets retain
 // separation even at the furthest point of each ruffling stroke.
 const sideDistance=ruffle?span*.96+.026*time.rubX:span*.55;
 const nearDistance=ruffle?.055+.028*time.rubZ:.066;
 const lift=ruffle?.038:.025+.075*(1-time.patPulse);
 const scalpUp=headUp.clone().normalize().lerp(up,.70).normalize();
 const goal=crown.clone()
  .addScaledVector(lateral,sideDistance*sign)
  .addScaledVector(forward,-nearDistance)
  .addScaledVector(scalpUp,lift);
 // Existing furnitureHandRotation interprets 'normal' as bone +Y.
 // On this rig the *palm face* is local -Y: +Y must point upward so the
 // palm, not its back, faces DOWN onto the hair.
 const normal=up.clone().lerp(scalpUp,.32).normalize();
 const direction=lateral.clone().multiplyScalar(sign).addScaledVector(forward,.24).normalize();
 const shoulder=actor.rig?.bones?.[side+'_upperArm']?.getWorldPosition(new T.Vector3());
 const elbow=actor.rig?.bones?.[side+'_forearm']?.getWorldPosition(new T.Vector3());
 const wrist=actor.rig?.bones?.[side+'_hand']?.getWorldPosition(new T.Vector3());
 let deficit=0;
 if(shoulder&&elbow&&wrist){
  const length=shoulder.distanceTo(elbow)+elbow.distanceTo(wrist);
  const distance=shoulder.distanceTo(goal);
  const allowed=Math.max(.02,length*.95);
  deficit=Math.max(0,distance-allowed);
  if(distance>allowed){
   // A CCD chain cannot grow; cap the goal on its near-side reachable arc
   // instead of forcing an elbow flip or pulling the hand through the skull.
   goal.copy(shoulder).lerp(goal,allowed/distance);
  }
 }
 return {side,point:goal,direction,normal,deficit};
}

/**
 * Giver: one palm makes two separate top-of-head pats; then both hands make
 * two left/right ruffling passes. The target follows recipient head/hair
 * every frame, so the recipient may nod without leaving a floating wrist.
 */
export function applyHeadPatMotion(
 recipe:HeadTouchRecipe,
 both:readonly [Resident,Resident],
 actionTime:number,
 weight:number
):boolean{
 const [giver,receiver]=both;
 if(!giver?.visitor||!receiver?.visitor||!Number.isFinite(actionTime))return false;
 const p=headPatTimeline(actionTime,recipe);
 const strength=saturate(weight);
 if(strength<=0)return false;
 const targetV=receiver.visitor,actor=giver.visitor;
 // Recipient accepts the first gentle pats; surprise develops during ruffling.
 if(targetV.rig){
  const {head,neck,chest}=targetV.rig.bones;
  const nod=.028*p.single*(1-p.rub)+.055*p.rub*Math.sin(p.time*10.2);
  const shake=.085*p.rubX*p.surprised;
  if(neck)neck.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(nod*.55,shake*.4,-shake*.25)));
  if(head)head.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(nod,shake,shake*.6)));
  if(chest)chest.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(-.018*p.surprised,0,-.025*p.rubZ*p.surprised)));
 }
 targetV.root.updateWorldMatrix(true,true);
 const crown=targetV.getHeadTopWorldPosition();
 const headQ=targetV.rig?.bones.head?.getWorldQuaternion(new T.Quaternion())??targetV.root.getWorldQuaternion(new T.Quaternion());
 const scalpUp=new T.Vector3(0,1,0).applyQuaternion(headQ);
 const scale=targetV.rig?.mesh.getWorldScale(new T.Vector3()).x??1;
 const span=T.MathUtils.clamp(.14*scale,.085,.20);
 const altSide=recipe.patSide==='R'?'L':'R';
 const paint=(side:'L'|'R',blend:number,other:boolean)=>{
  const w=strength*blend;
  if(w<=.001)return;
  const contact=headPatHandGoal(actor,targetV,side,crown,scalpUp,span,p,other);
  if(giver.solver&&actor.rig){
   // Do not make a deeply unreachable arm fold across the body. Most of the
   // reach is recovered by standingHeightAdaptation (taller bends first);
   // the remaining shortfall is a gentle approach, not a fake contact.
   const reachFactor=T.MathUtils.clamp(1-contact.deficit/.42,.28,1);
   giver.solver({side,point:contact.point,direction:contact.direction,
    normal:contact.normal,curl:other?.20:.06},w*reachFactor);
  }else actor.classicContact(side,contact.point,w);
 };
 // Both hands retain their own shoulder lanes, even during two-hand rubbing.
 paint(recipe.patSide,p.single,p.rub>.001);
 paint(altSide,p.double,true);
 return true;
}
/** Run after the common presentation stage, which otherwise sets both
 * characters to the generic 'smiling' category expression. */
export function applyHeadPatExpressions(
 recipe:HeadTouchRecipe,both:readonly [Resident,Resident],actionTime:number
){
 const surprise=headPatTimeline(actionTime,recipe).surprised>.35;
 both[0]?.visitor.setActionExpression('smiling',actionTime);
 both[1]?.visitor.setActionExpression(surprise?'surprised':'smiling',actionTime);
}
