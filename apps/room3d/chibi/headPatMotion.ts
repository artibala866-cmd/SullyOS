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
 const scale=targetV.rig?.mesh.getWorldScale(new T.Vector3()).x??1;
 const span=T.MathUtils.clamp(.115*scale,.085,.20);
 const altSide=recipe.patSide==='R'?'L':'R';
 const paint=(side:'L'|'R',blend:number,other:boolean)=>{
  const w=strength*blend;
  if(w<=.001)return;
  const sideSign=side==='L'?-1:1;
  const wiggle=other?p.rubX*.065*sideSign:0;
  const along=other?p.rubZ*.033:0;
  // Never press the palm goal under the measured hair bounding surface.
  // On each pat, move down close to the hair then back up.
  const lift=other?.038:.044+(p.time<3.12?.085*(1-p.patPulse):0);
  const local=new T.Vector3(sideSign*(other?span*.85:span*.18)+wiggle, lift,along-.03);
  const target=crown.clone().add(local.applyQuaternion(headQ));
  if(giver.solver&&actor.rig){
   const normal=new T.Vector3(0,-1,0).applyQuaternion(headQ);
   const direction=new T.Vector3(side==='L'?1:-1,0,0).applyQuaternion(actor.root.getWorldQuaternion(new T.Quaternion()));
   giver.solver({side,point:target,direction,normal,curl:other?.28:.10},w);
  }else actor.classicContact(side,target,w);
 };
 // Resolve crown once, use the same target frame for both hands; no IK chase.
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
