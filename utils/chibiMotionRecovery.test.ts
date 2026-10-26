import {it,expect} from 'vitest';
import * as T from 'three';
import {sampleSocialApproach} from '../apps/room3d/chibi/selectedSocial';
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


it('social approach has deterministic acceleration, deceleration and continuous corner heading',()=>{
 const path=[new T.Vector3(0,0,0),new T.Vector3(0,0,2),new T.Vector3(2,0,2)];
 const duration=4;
 for(const hz of [30,60,120]){
  let previous=sampleSocialApproach(path,0,duration),maxTurn=0;
  const distances:number[]=[];
  for(let frame=1;frame<=hz*duration;frame++){
   const s=sampleSocialApproach(path,frame/hz,duration);
   expect(s.position.x).toBeGreaterThanOrEqual(-1e-9);
   expect(s.position.z).toBeGreaterThanOrEqual(-1e-9);
   expect(s.position.x).toBeLessThanOrEqual(2+1e-9);
   expect(s.position.z).toBeLessThanOrEqual(2+1e-9);
   expect(s.progress+1e-10).toBeGreaterThanOrEqual(previous.progress);
   if(previous.heading!==null&&s.heading!==null){
    let delta=Math.atan2(Math.sin(s.heading-previous.heading),Math.cos(s.heading-previous.heading));
    maxTurn=Math.max(maxTurn,Math.abs(delta));
   }
   distances.push(previous.position.distanceTo(s.position));
   previous=s;
  }
  expect(previous.position.distanceTo(path[2])).toBeLessThan(1e-8);
  expect(previous.speed).toBeCloseTo(0,8);
  expect(distances[0]).toBeLessThan(distances[Math.floor(hz*.8)]*.5);
  expect(distances.at(-1)!).toBeLessThan(distances[Math.floor(hz*.8)]*.5);
  expect(maxTurn).toBeLessThan(.70);
 }
 const a=sampleSocialApproach(path,1.37,duration),b=sampleSocialApproach(path,1.37,duration);
 expect(a.position.distanceTo(b.position)).toBe(0);
 expect(a.heading).toBe(b.heading);
 expect(sampleSocialApproach(path,-10,duration).position.distanceTo(path[0])).toBe(0);
 expect(sampleSocialApproach(path,10,duration).position.distanceTo(path[2])).toBe(0);
 const stationary=sampleSocialApproach([path[0],path[0]],2,duration);
 expect(stationary.speed).toBe(0);
 expect(stationary.heading).toBeNull();
});
