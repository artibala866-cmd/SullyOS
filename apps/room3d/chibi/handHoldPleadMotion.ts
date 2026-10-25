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
 const first=envelope(1.48,1.68,2.76,3);
 const last=envelope(4.80,4.95,5.52,5.83);
 const f=clamp((t-1.5)/1.5,0,1),g=clamp((t-4.8)/1.03,0,1);
 return {
  reach:smooth(t,.12,.86),
  grip:smooth(t,.78,1.48)*(1-smooth(t,6.05,6.65)),
  reply:smooth(t,1.01,1.66)*(1-smooth(t,6.24,6.70)),
  first, last,
  swing:first*Math.sin(f*Math.PI*4)*(.78-.18*f)+
   last*Math.sin(g*Math.PI*4)*(.65-.31*g),
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
 // The small downward hand placement is bounded by *both* remaining reaches.
 const room=Math.max(0,Math.min(a-shoulderA.distanceTo(point),b-shoulderB.distanceTo(point)));
 point.y-=Math.min(room*.6,.065);
 point.add(wave);
 return {point,reachable,deficit:Math.max(0,distance-a-b)};
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
 const sway=p.swing*strength;
 ar.spine.quaternion.multiply(q(.035*p.tug+.025*p.glance,0,
  (sign*.065*sway+sign*.025*p.foot)*strength));
 ar.chest.quaternion.multiply(q(.042*p.tug,0,(sign*.047*sway)*strength));
 // Stagger shoulders instead of moving them in perfect mechanical sync.
 const delayed=handHoldPleadPhase(Math.max(0,time-.11));
 ar[handA+'_clavicle'].quaternion.multiply(q(0,0,sign*(.055*p.shrug+.022*delayed.swing)*strength));
 ar[(handA==='L'?'R':'L')+'_clavicle'].quaternion.multiply(q(0,0,-sign*.025*p.shrug*strength));
 br[handB+'_clavicle'].quaternion.multiply(q(0,0,-sign*.024*handHoldPleadPhase(Math.max(0,time-.16)).swing*strength));
 br.chest.quaternion.multiply(q(.016*p.reply*strength,0,-sign*.015*p.reply*strength));
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
 // Both recipients' hands track the SAME contact anchor and wave.
 const sideAxis=new T.Vector3(1,0,0).applyQuaternion(bv.root.getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
 const scale=Math.min(av.root.getWorldScale(new T.Vector3()).x,bv.root.getWorldScale(new T.Vector3()).x);
 const lateral=sideAxis.multiplyScalar((.064*p.swing-.034*p.tug)*scale*strength);
 const goal=pleadContactTarget(armA.shoulder,armA.max,armB.shoulder,armB.max,lateral);
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
