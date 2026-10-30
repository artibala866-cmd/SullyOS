import * as T from 'three';
import type {MotionFrame} from './selectedMotions';

// The upstream captured performance is a pose source, not a second navigation
// or IK owner. The existing local lift, planted-foot, hand-contact and
// collision solvers remain authoritative.
const fade=(t:number,a:number,b:number,c:number,d:number)=>
 T.MathUtils.smootherstep(t,a,b)*(1-T.MathUtils.smootherstep(t,c,d));

export const carryCaptureWeight=(time:number)=>fade(time,.1,1,9.05,9.95);

/** Amend only the sampled per-frame copy. Never mutate the cached clip. */
export function prepareCarryFrame(frame:MotionFrame,time:number){
 frame.position.y=0; // Vertical transfer belongs to the shared carry solver.
 for(const [name,rotation] of Object.entries(frame.rotations)){
  // Pair support IK owns arms, and planted-foot / lift articulation owns
  // thighs, shins, ankles and toes. Captured human-leg rotations otherwise
  // make the Q-rig's unsupported recipient bend/fly before first contact.
  if(/^[LR]_(upperArm|forearm|hand|thigh|shin|foot|toe)$/.test(name)){
   delete frame.rotations[name];continue;
  }
  const e=new T.Euler().setFromQuaternion(rotation,'YXZ');
  const limit=name==='hips'?.08:name==='spine'?.12:name==='chest'?.20:name==='neck'?.13:name==='head'?.23:null;
  if(limit!==null){
   e.x=limit*Math.tanh(e.x/.35);
   e.y=limit*Math.tanh(e.y/.35);
   e.z=limit*Math.tanh(e.z/.35);
   rotation.setFromEuler(e);
  }
 }
}
