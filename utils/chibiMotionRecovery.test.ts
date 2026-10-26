import {it,expect} from 'vitest';
import {motionContactProfiles} from '../apps/room3d/chibi/motionContactProfiles';
import {motionTemplateConstraintPlans,motionTemplateFor} from '../apps/room3d/chibi/motionTemplates';
import {createMotionConstraintPipeline} from '../apps/room3d/chibi/motionConstraintPipeline';
import {createWorldFootLock} from '../apps/room3d/chibi/legContactIK';

it('preserves all eight authored contact recipes while opting into one ordered solver pass',()=>{
 const ids=Object.keys(motionContactProfiles);
 expect(ids).toHaveLength(8);
 for(const id of ids){
  const template=motionTemplateFor(id)!;
  expect(template.contact).toBe(motionContactProfiles[id]);
  expect(template.standingHeight).toBe('contact');
  expect(motionTemplateConstraintPlans[id]).toEqual(['bodyPlacement','clearance','contactIK','presentation']);
  const visited:string[]=[];
  const runtime=createMotionConstraintPipeline({
   bodyPlacement:()=>visited.push('bodyPlacement'),
   clearance:()=>visited.push('clearance'),
   contactIK:()=>visited.push('contactIK'),
   presentation:()=>visited.push('presentation'),
  },motionTemplateConstraintPlans);
  expect(runtime.activate(id)).toBe(true);
  expect(runtime.run()).toBe(true);
  expect(visited).toEqual(['bodyPlacement','clearance','contactIK','presentation']);
 }
});
it('stance lock discards support across interrupted actions',()=>{
 const lock=createWorldFootLock();
 expect(lock.supportSide).toBeNull();
 lock.reset();
 expect(lock.supportSide).toBeNull();
});
