import {describe,expect,it,vi} from 'vitest';
import {createMotionConstraintPipeline,motionConstraintPlans,type MotionConstraintPhase} from './motionConstraintPipeline';

const phases:readonly MotionConstraintPhase[]=['bodyPlacement','clearance','contactIK','presentation'];
function fixture(plans=motionConstraintPlans){
 const calls:MotionConstraintPhase[]=[];
 const handlers={
  bodyPlacement:vi.fn(()=>calls.push('bodyPlacement')),
  clearance:vi.fn(()=>calls.push('clearance')),
  contactIK:vi.fn(()=>calls.push('contactIK')),
  presentation:vi.fn(()=>calls.push('presentation')),
 };
 return {calls,handlers,runner:createMotionConstraintPipeline(handlers,plans)};
}
describe('lightweight reusable motion constraint scheduler',()=>{
 it('opts in only the tested hand motion and leaves intimacy and other actions untouched',()=>{
  const {runner,calls}=fixture();
  expect(runner.activate('home-hug')).toBe(false);
  expect(runner.run()).toBe(false);
  expect(runner.activate('home-kiss')).toBe(false);
  expect(runner.activate('cmu-18_03')).toBe(false);
  expect(runner.activate('cmu-20_10')).toBe(true);
  expect(runner.phases).toEqual(phases);
  expect(runner.run()).toBe(true);
  expect(calls).toEqual(phases);
 });
 it('resets on cancel/end and never invokes an inactive solver',()=>{
  const {runner,calls,handlers}=fixture();
  expect(runner.run()).toBe(false);
  runner.activate('cmu-20_10');
  runner.run();
  runner.reset();
  expect(runner.phases).toBeUndefined();
  expect(runner.run()).toBe(false);
  for(const phase of phases)expect(handlers[phase]).toHaveBeenCalledTimes(1);
  expect(calls).toHaveLength(4);
 });
 it('allows action-specific ordering without sorting or allocating handlers per frame',()=>{
  const other:Readonly<Record<string,readonly MotionConstraintPhase[]>>={
   special:['bodyPlacement','contactIK','clearance','presentation'],
   lean:['bodyPlacement','presentation'],
  };
  const {runner,calls,handlers}=fixture(other);
  runner.activate('special');
  runner.run();
  runner.run();
  expect(calls).toEqual([...other.special,...other.special]);
  expect(handlers.contactIK).toHaveBeenCalledTimes(2);
  runner.activate('lean');
  runner.run();
  expect(calls.slice(-2)).toEqual(other.lean);
  expect(handlers.clearance).toHaveBeenCalledTimes(2);
 });
});
