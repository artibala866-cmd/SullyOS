import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {contactSolver,Contact} from './socialContact';
import {applyStandingHeightAdaptation} from './standingHeightAdaptation';
import {settleLegContact} from './legContactIK';

type Side='L'|'R';
type Participant={visitor:ChibiVisitor;solver:ReturnType<typeof contactSolver>};
const smooth=T.MathUtils.smootherstep,clamp=T.MathUtils.clamp;
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));

/** B stays at its existing nav root; A takes the ordinary room path to a
 * reachable hand-holding position on either side of B's forward direction.
 * +1 is B's local +X (B left hand, A right hand); -1 reverses both. */
export function pleadStandingPoint(receiver:T.Vector3,rotation:T.Quaternion,sign:1|-1){
 return receiver.clone().add(new T.Vector3(sign*.26,0,.76).applyQuaternion(rotation));
}
export function pleadHandSides(sign:1|-1):readonly [Side,Side]{
 return sign===1?['R','L']:['L','R'];
}

/** 6.7 seconds of gesture AFTER house navigation. Contact is one shared point;
 * the recipient's shoulders react later, but both palms move together. */
export function handHoldPleadPhase(time:number){
 const t=clamp(Number.isFinite(time)?time:0,0,6.7);
 const envelope=(start:number,up:number,down:number,end:number)=>
  smooth(t,start,up)*(1-smooth(t,down,end));
 const firstA=envelope(1.53,1.93,1.93,2.27);
 const firstB=envelope(2.28,2.59,2.59,2.99);
 const lastA=envelope(4.82,5.12,5.12,5.40);
 const lastB=envelope(5.41,5.65,5.65,5.93);
 const first=Math.max(firstA,firstB),last=Math.max(lastA,lastB);
 const open=firstA*.98+firstB*.78+lastA*.72+lastB*.53;
 return {
  reach:smooth(t,.12,.86),
  grip:smooth(t,.78,1.48)*(1-smooth(t,6.05,6.65)),
  reply:smooth(t,1.01,1.66)*(1-smooth(t,6.24,6.70)),
  first,last,open,
  swing:open,
  foot:envelope(3.0,3.43,4.28,4.75),
  toe:envelope(3.25,3.72,4.14,4.65),
  tug:envelope(3.38,3.67,3.88,4.32),
  shrug:envelope(3.48,3.77,4.04,4.45)+.46*envelope(5.65,5.81,5.97,6.25),
  glance:envelope(.45,1.50,5.91,6.68),
  stroke:envelope(5.12,5.27,5.45,5.60),
 };
}
function length(v:ChibiVisitor,side:Side){
 const b=v.rig!.bones;
 const s=b[side+'_upperArm'].getWorldPosition(new T.Vector3());
 const e=b[side+'_forearm'].getWorldPosition(new T.Vector3());
 const w=b[side+'_hand'].getWorldPosition(new T.Vector3());
 return {shoulder:s,max:s.distanceTo(e)+e.distanceTo(w)};
}

/** Do not chase one hand after solving the other. Choose the same world target
 * from both shoulder chains BEFORE either solver runs. If extreme scale makes
 * the hands physically unreachable, return the nearest honest compromise
 * without forcing either arm past its own bone length. */
export function pleadContactTarget(
 shoulderA:T.Vector3,reachA:number,shoulderB:T.Vector3,reachB:number,
 wave:T.Vector3=new T.Vector3()
){
 const distance=shoulderA.distanceTo(shoulderB);
 const a=Math.max(.01,reachA*.93),b=Math.max(.01,reachB*.93);
 const along=distance<1e-6?.5:clamp((distance+a-b)/(2*distance),.02,.98);
 const point=shoulderA.clone().lerp(shoulderB,along);
 const reachable=distance<=a+b;
 const room=Math.max(0,Math.min(a-shoulderA.distanceTo(point),b-shoulderB.distanceTo(point)));
 point.y-=Math.min(room*.6,.045);
 // Keep the moving joined palms in the intersection of both arm-reach spheres.
 // Scale only the OUTWARD swing when one short arm approaches its limit.
 const inside=(p:T.Vector3)=>p.distanceTo(shoulderA)<=a+1e-6&&p.distanceTo(shoulderB)<=b+1e-6;
 let applied=1;
 if(reachable&&wave.lengthSq()>1e-9&&!inside(point.clone().add(wave))){
  let low=0,high=1;
  for(let i=0;i<14;i++){
   const mid=(low+high)*.5;
   if(inside(point.clone().addScaledVector(wave,mid)))low=mid;
   else high=mid;
  }
  applied=low;
 }
 point.addScaledVector(wave,applied);
 return {point,reachable,deficit:Math.max(0,distance-a-b),appliedWave:applied};
}

/** A shared, clearly visible arc: the held hands open towards B's outer
 * flank, then return together. Both actors solve the same moving goal.
 */
export function pleadHandSwingOffset(time:number,sign:1|-1,scale=1){
 const p=handHoldPleadPhase(time);
 return new T.Vector3(sign*.215*p.open,.024*p.open,-.034*p.open-.058*p.tug)
  .multiplyScalar(scale);
}

/** Pair geometry: the local -Y side is the palm; +Y is the back. Opposing
 * world normals therefore make BOTH palms face one another, not back-to-back.
 */
export function pleadPalmContact(
 visitor:ChibiVisitor,side:Side,point:T.Vector3,outward:T.Vector3,curl=.25
):Contact{
 const normal=outward.clone().normalize();
 const sign=side==='L'?1:-1;
 const tangent=new T.Vector3(sign,0,0).applyQuaternion(visitor.root.getWorldQuaternion(new T.Quaternion()));
 tangent.addScaledVector(normal,-tangent.dot(normal));
 if(tangent.lengthSq()<1e-5)tangent.set(0,1,0).addScaledVector(normal,-normal.y);
 tangent.normalize();
 return {side,point,direction:tangent,normal,curl};
}

/** No nav-root translation; A leads, B responds after 0.15 seconds.
 * Height correction/foot contact reuses the already-loaded common helpers.
 */
export function poseHandHoldPlead(both:readonly [Participant,Participant],time:number,sign:1|-1,weight=1){
 const [a,b]=both;
 if(!a.visitor.rig||!b.visitor.rig||!a.solver||!b.solver)return false;
 const av=a.visitor,bv=b.visitor,strength=clamp(weight,0,1),p=handHoldPleadPhase(time);
 const [handA,handB]=pleadHandSides(sign);
 if(strength<=0)return false;
 const ar=av.rig.bones,br=bv.rig.bones;
 av.root.updateWorldMatrix(true,true);
 bv.root.updateWorldMatrix(true,true);
 const faceA=av.getHeadWorldPosition(),faceB=bv.getHeadWorldPosition();
 const diff=faceB.y-faceA.y;
 // Only the taller actor yields slightly; never make the shorter actor jump
 // or lift the planted foot just to connect hands.
 if(Math.abs(diff)>.32&&p.grip>.01)applyStandingHeightAdaptation([av,bv],{
  mode:'contact',weight:strength*p.grip*.36,
 });
 // Lead from the clasped hands. The torso/shoulders FOLLOW each outward
 // excursion smoothly instead of vibrating at a separate sine frequency.
 const aFollow=handHoldPleadPhase(Math.max(0,time-.10));
 const bFollow=handHoldPleadPhase(Math.max(0,time-.19));
 ar.spine.quaternion.multiply(q((.020*p.tug+.019*p.glance)*strength,0,
  sign*(.036*aFollow.open+.020*p.foot)*strength));
 ar.chest.quaternion.multiply(q(.028*p.tug*strength,0,
  sign*.024*aFollow.open*strength));
 ar[handA+'_clavicle'].quaternion.multiply(q(0,0,
  sign*(.030*p.shrug+.015*aFollow.open)*strength));
 ar[(handA==='L'?'R':'L')+'_clavicle'].quaternion.multiply(q(0,0,
  -sign*.011*p.shrug*strength));
 br[handB+'_clavicle'].quaternion.multiply(q(0,0,
  -sign*.012*bFollow.open*strength));
 br.chest.quaternion.multiply(q(.013*p.reply*strength,0,
  -sign*.016*bFollow.open*strength));
 const shortPitch=clamp(Math.abs(diff)*.22,0,.23);
 ar.head.quaternion.multiply(q((diff>0?-shortPitch:shortPitch)*p.glance*strength,0,
  (-sign*(.16*p.glance+.055*p.toe))*strength));
 br.head.quaternion.multiply(q((diff<0?-shortPitch:shortPitch)*p.reply*strength,0,
  (sign*.065*p.reply)*strength));
 // Non-support back toe: preserve the support leg and navigation root.
 // Set a target behind the original toe, then settle the short two-bone leg.
 if(p.foot>.002){
  const side=handA==='L'?'R':'L';
  const toe=ar[side+'_toe'].getWorldPosition(new T.Vector3());
  const scale=av.root.getWorldScale(new T.Vector3()).x;
  const target=toe.clone().add(new T.Vector3(0,0,-.055*scale*p.toe).applyQuaternion(
   av.root.getWorldQuaternion(new T.Quaternion())));
  ar[side+'_thigh'].quaternion.multiply(q(-.18*p.foot*strength));
  ar[side+'_shin'].quaternion.multiply(q(.37*p.foot*strength));
  ar[side+'_foot'].quaternion.multiply(q(-.12*p.foot*strength));
  av.root.updateWorldMatrix(true,true);
  settleLegContact(av,side,target,p.toe*strength*.8);
 }
 av.root.updateWorldMatrix(true,true);
 bv.root.updateWorldMatrix(true,true);
 const armA=length(av,handA),armB=length(bv,handB);
 const horizontal=bv.root.position.clone().sub(av.root.position).setY(0).normalize();
 // Compute the joined hands' wide opening/closing arc in B's local frame.
 // A and B solve the SAME animated anchor, not independent wrist shivers.
 const scale=Math.min(av.root.getWorldScale(new T.Vector3()).x,bv.root.getWorldScale(new T.Vector3()).x);
 const worldArc=pleadHandSwingOffset(time,sign,scale*strength)
  .applyQuaternion(bv.root.getWorldQuaternion(new T.Quaternion()));
 const goal=pleadContactTarget(armA.shoulder,armA.max,armB.shoulder,armB.max,worldArc);
 // A tiny initial finger touch; then bring the two entire palms to one point.
 // Grip weight is reduced only for genuinely unreachable height differences.
 const reachWeight=clamp(1-goal.deficit/.30,.35,1);
 const wa=strength*p.reach*p.grip*reachWeight;
 const wb=strength*p.reply*p.grip*reachWeight;
 const ca=pleadPalmContact(av,handA,goal.point,horizontal.clone().negate(),.31);
 const cb=pleadPalmContact(bv,handB,goal.point,horizontal,.27);
 a.solver(ca,wa);
 b.solver(cb,wb);
 // Gentle B thumb squeeze at the end; never overwrite the shared palm IK.
 const thumb=br[handB+'_thumb'];
 if(thumb&&p.stroke>.001)thumb.quaternion.multiply(q(0,0,sign*.075*p.stroke*strength));
 av.root.updateWorldMatrix(true,true);
 bv.root.updateWorldMatrix(true,true);
 return true;
}
