import * as T from 'three';
import type {MotionFrame} from './selectedMotions';

// The upstream captured performance is a pose source, not a second navigation
// or IK owner. The existing local lift, planted-foot, hand-contact and
// collision solvers remain authoritative.
const fade=(t:number,a:number,b:number,c:number,d:number)=>
 T.MathUtils.smootherstep(t,a,b)*(1-T.MathUtils.smootherstep(t,c,d));
const q=(x=0,y=0,z=0)=>new T.Quaternion().setFromEuler(new T.Euler(x,y,z));

export const carryCaptureWeight=(time:number)=>fade(time,.1,1,9.05,9.95);

/** Amend only the sampled per-frame copy. Never mutate the cached clip. */
export function prepareCarryFrame(frame:MotionFrame,time:number){
 const hold=fade(time,3.85,4.6,6.65,7.4);
 frame.position.y=0; // Vertical transfer belongs to the shared carry solver.
 for(const [name,rotation] of Object.entries(frame.rotations)){
  // Both hands must stay under the existing shared support IK.
  if(/^[LR]_(upperArm|forearm|hand)$/.test(name)){
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
  if(name.endsWith('_foot')){
   // Captured human ankle rolls cannot replace the Q-rig's floor support.
   rotation.identity().slerp(q(e.x*.12,e.y*.08,e.z*.08),hold);
  }
 }
}
