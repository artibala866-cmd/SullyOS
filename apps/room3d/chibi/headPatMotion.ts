import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver} from './socialContact';
import type {HeadTouchRecipe} from './motionTemplates';
import {BLANK_SCALE,BLANK_HEAD_SCALE} from './blankBody';

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

/**
 * Hair/scalp breadth is large on the chibi (the head is NOT human sized).
 * Before this fix the target span was just .085-.20 world units, leaving
 * both palms nearly at crown center (actual half-width often > .4).
 *
 * Derive a lightweight ellipsoid from the already-loaded head geometry and
 * world scale. Do not traverse the whole hair mesh each animation frame.
 */
export function headPatScalpSize(recipient:ChibiVisitor){
 const rig=recipient.rig;
 if(!rig?.mesh||!rig.bones?.head)return {radius:.36,depth:.32,height:.38};
 const worldScale=rig.bones.head.getWorldScale(new T.Vector3());
 const headSize=(rig.mesh.geometry?.userData?.headSize as number|undefined)??1;
 const scale=Math.max(Math.abs(worldScale.x),Math.abs(worldScale.z));
 const radius=T.MathUtils.clamp(.198*BLANK_SCALE*BLANK_HEAD_SCALE.x*headSize*scale+.025,.24,2.20);
 return {radius,depth:radius*.87,height:radius*.86};
}

/**
 * Dual-head-side contact. Align left and right scalp targets with the
 * GIVER'S actual shoulders (not the recipient's mirrored local X).
 *
 * The hand belongs on the UPPER OUTER SIDE of the head, not on its crown:
 * project a point onto an ellipsoidal cap, allowing short rub strokes that
 * never come near the middle parting. Each goal carries its outward scalp
 * surface normal, used to face the palm INTO the hair.
 */
export function headPatHandGoal(
 actor:ChibiVisitor,recipient:ChibiVisitor,side:'L'|'R',
 crown:T.Vector3,headUp:T.Vector3,span:number,
 time:ReturnType<typeof headPatTimeline>,ruffle:boolean
){
 actor.root.updateWorldMatrix(true,true);
 const worldUp=new T.Vector3(0,1,0);
 const scalpUp=headUp.clone().normalize();
 if(scalpUp.lengthSq()<.5)scalpUp.copy(worldUp);
 const shoulders=actor.rig?.bones;
 const lShoulder=shoulders?.L_upperArm?.getWorldPosition(new T.Vector3());
 const rShoulder=shoulders?.R_upperArm?.getWorldPosition(new T.Vector3());
 const shoulderMid=lShoulder&&rShoulder?lShoulder.clone().add(rShoulder).multiplyScalar(.5):
  actor.root.getWorldPosition(new T.Vector3());
 // Project all head-side offsets into the receiving scalp's tangent plane.
 const facing=crown.clone().sub(shoulderMid).addScaledVector(scalpUp,
  -crown.clone().sub(shoulderMid).dot(scalpUp));
 if(facing.lengthSq()<1e-7)facing.set(0,0,1).applyQuaternion(actor.root.getWorldQuaternion(new T.Quaternion()));
 facing.normalize();
 const lateral=lShoulder&&rShoulder?lShoulder.clone().sub(rShoulder):
  new T.Vector3().crossVectors(worldUp,facing);
 lateral.addScaledVector(scalpUp,-lateral.dot(scalpUp));
 if(lateral.lengthSq()<1e-7)lateral.crossVectors(scalpUp,facing);
 lateral.normalize();
 // Keep the axes orthogonal, avoiding accidental inward offsets during yaw.
 const toward=facing.clone().addScaledVector(lateral,-facing.dot(lateral)).normalize();
 if(toward.lengthSq()<1e-7)toward.crossVectors(lateral,scalpUp).normalize();
 const sign=side==='L'?1:-1;
 const radius=Math.max(.18,span);
 const depth=radius*.87;
 const height=radius*.86;
 // 72%-83% of head half width, so hands always occupy separate side panels.
 // Rubbing has two short opposite-direction strokes, never a lane swap.
 const sideways=radius*(ruffle?.77:.75)+(ruffle?.022*time.rubX:0);
 const near=radius*(ruffle?.17:.14)+(ruffle?.018*time.rubZ:0);
 const x=Math.min(sideways,radius*.85),z=T.MathUtils.clamp(near,0,depth*.27);
 const normalized=Math.min(.96,(x/radius)**2+(z/depth)**2);
 const cap=Math.sqrt(1-normalized);
 const floating=ruffle?.036:.035+.055*(1-time.patPulse);
 const y=-height*(1-cap)+floating;
 const scalpPoint=crown.clone()
  .addScaledVector(lateral,sign*x)
  .addScaledVector(toward,-z)
  .addScaledVector(scalpUp,y);
 // The outward normal is NOT world-up on the side of a giant chibi head.
 // The -Y hand face must point inward/downward along this surface normal.
 const normal=lateral.clone().multiplyScalar(sign*x/(radius*radius))
  .addScaledVector(toward,-z/(depth*depth))
  .addScaledVector(scalpUp,cap/height).normalize();
 // A fingertip direction must lie in the scalp's tangent plane. Using
 // the outward side vector for both normal AND finger direction made the
 // rotation basis degenerate and turned the palm sideways/upward.
 const direction=toward.clone().negate().addScaledVector(scalpUp,.24);
 direction.addScaledVector(normal,-direction.dot(normal)).normalize();
 const shoulder=shoulders?.[side+'_upperArm']?.getWorldPosition(new T.Vector3());
 const elbow=shoulders?.[side+'_forearm']?.getWorldPosition(new T.Vector3());
 const wrist=shoulders?.[side+'_hand']?.getWorldPosition(new T.Vector3());
 const point=scalpPoint.clone();
 let deficit=0,crossLane=false;
 if(shoulder&&elbow&&wrist){
  const length=shoulder.distanceTo(elbow)+elbow.distanceTo(wrist);
  const distance=shoulder.distanceTo(scalpPoint);
  const allowed=Math.max(.02,length*.95);
  deficit=Math.max(0,distance-allowed);
  if(distance>allowed){
   // Restrict the unreachable goal to the approaching arm's reach, without
   // putting it into the other side's lane or through the hair.
   point.copy(shoulder).lerp(scalpPoint,allowed/distance);
   // An extremely short actor may still be too far away. Don't command
   // opposite-lane IK in that case: let the tall partner crouch first.
   const sideValue=point.clone().sub(crown).dot(lateral)*sign;
   if(sideValue<radius*.40)crossLane=true;
  
  }
 }
 return {side,point,direction,normal,deficit,crossLane,scalpPoint,scalpRadius:radius};
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
 const span=headPatScalpSize(targetV).radius;
 const altSide=recipe.patSide==='R'?'L':'R';
 const paint=(side:'L'|'R',blend:number,other:boolean)=>{
  const w=strength*blend;
  if(w<=.001)return;
  const contact=headPatHandGoal(actor,targetV,side,crown,scalpUp,span,p,other);
  // Suppress an IK command whose only reachable goal would cut through the
  // head's center. Let the existing taller-person bow/crouch reduce the gap.
  if(contact.crossLane)return;
  if(giver.solver&&actor.rig){
   // Do not make a deeply unreachable arm fold across the body. Most of the
   // reach is recovered by standingHeightAdaptation (taller bends first);
   // the remaining shortfall is a gentle approach, not a fake contact.
   const reachFactor=T.MathUtils.clamp(1-contact.deficit/.36,.18,1);
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
