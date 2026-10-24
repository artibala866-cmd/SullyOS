/**
 * Stage 2: post-pose constraints only. Base animation/pose sampling remains in
 * the existing player; each plan chooses the required order after it.
 * Plans are immutable, selected once per action, and never sort in the frame loop.
 * No IK solvers, animation clips or spatial data are created by this scheduler.
 */
export type MotionConstraintPhase='bodyPlacement'|'clearance'|'contactIK'|'presentation';
export type MotionConstraintPlan=readonly MotionConstraintPhase[];
export type MotionConstraintHandlers=Readonly<Record<MotionConstraintPhase,()=>void>>;

/**
 * Opt-in migration only. Keep head/embrace/carry/seat solvers in their legacy
 * paths until verified individually. Chibi hands are part of the existing
 * contact solver, so contactIK includes its authored finger-curl correction.
 */
export const motionConstraintPlans:Readonly<Record<string,MotionConstraintPlan>>={
 'cmu-20_10':['bodyPlacement','clearance','contactIK','presentation'],
};

export function createMotionConstraintPipeline(
 handlers:MotionConstraintHandlers,
 plans:Readonly<Record<string,MotionConstraintPlan>>=motionConstraintPlans
){
 let active:MotionConstraintPlan|undefined;
 return {
  activate(action:string){active=plans[action];return !!active;},
  reset(){active=undefined;},
  get phases():MotionConstraintPlan|undefined{return active;},
  run(){
   const plan=active;
   if(!plan)return false;
   for(let i=0;i<plan.length;i++)handlers[plan[i]]();
   return true;
  },
 };
}
