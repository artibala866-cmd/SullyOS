/**
 * Lightweight horizontal body-shell correction for free residents.
 * Unlike walking clearance this also separates people who START overlapped
 * (for example a person rising from a sofa after a seated hug).
 *
 * The seated/transition actor is an immovable anchor; the caller selects an
 * eligible standing actor to yield. This function never moves both people,
 * changes a root Y/rotation or bypasses the room's furniture clearance.
 */
export function residentSeparationStep(mover,anchor,{
 minimum=1,
 maxStep=.09,
 free=()=>true,
}={}){
 if(![...mover,...anchor,minimum,maxStep].every(Number.isFinite))return null;
 if(minimum<=0||maxStep<=0)return null;
 const dx=mover[0]-anchor[0],dz=mover[1]-anchor[1],distance=Math.hypot(dx,dz);
 if(distance>=minimum-.001)return null;
 // Never push past the requested separation radius.
 const travel=Math.min(maxStep,minimum-distance);
 const heading=Math.atan2(dz,dx);
 const angles=[0,Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2];
 // A half-step allows residents to slide past nearby furniture instead of
 // jumping to a farther, unvalidated candidate.
 let best=null,bestScore=-Infinity;
 for(const scale of [1,.5,.25]){
  const step=travel*scale;
  if(step<.002)continue;
  for(const angle of angles){
   const x=mover[0]+Math.cos(heading+angle)*step;
   const z=mover[1]+Math.sin(heading+angle)*step;
   const improved=Math.hypot(x-anchor[0],z-anchor[1])-distance;
   if(improved<=.0005||!free(x,z))continue;
   const score=improved-.002*Math.abs(angle);
   if(score>bestScore){bestScore=score;best=[x,z];}
  }
  // Prefer a full safe step. Tiny motions are only a last resort.
  if(best)break;
 }
 if(best)return best;
 // After an authored close interaction, a character can start inside a
 // furniture-clearance buffer even though the outward exit is open floor.
 // Permit ONLY a short outward escape step if that exit is demonstrably free.
 // This does not allow an invalid endpoint or jumping through a wall.
 if(free(mover[0],mover[1]))return null;
 const exitDistance=Math.max(.12,minimum-distance+.08);
 for(const angle of angles){
  const ux=Math.cos(heading+angle),uz=Math.sin(heading+angle);
  const exitX=mover[0]+ux*exitDistance,exitZ=mover[1]+uz*exitDistance;
  if(Math.hypot(exitX-anchor[0],exitZ-anchor[1])<minimum||!free(exitX,exitZ))continue;
  return [mover[0]+ux*travel,mover[1]+uz*travel];
 }
 return null;
}

/** Choose who yields when two body shells intersect. Never displace a seated
 * or rising resident, and prefer the character over the user whenever free. */
export function chooseResidentToYield(first,second,preferredId){
 if(first.canMove&&first.id===preferredId)return 'first';
 if(second.canMove&&second.id===preferredId)return 'second';
 if(first.canMove&&!second.canMove)return 'first';
 if(second.canMove)return 'second';
 return first.canMove?'first':null;
}
