import {describe,it,expect} from 'vitest';
import {createMirrorJourney,mirrorJourneyFrame} from '../apps/room3d/mirrorJourney.js';
const activity={position:[0,.18,0],rotation:Math.PI,wardrobePose:{position:[0,.18,-3.4],rotation:0}};
describe('outfit trips',()=>{
 it('walks two round trips, pauses at each destination and finishes at the mirror',()=>{
  const j=createMirrorJourney(activity,activity.position,(a,b)=>[a,b]);
  expect(j.phases.filter(p=>p.motion==='walk')).toHaveLength(4);
  expect(j.phases.filter(p=>p.motion!=='walk').map(p=>p.destination)).toEqual(['wardrobe','mirror','wardrobe','mirror']);
  const moving=mirrorJourneyFrame(j,1);expect(moving.position[2]).toBeCloseTo(-1.7);expect(moving.motion).toBe('walk');
  expect(mirrorJourneyFrame(j,2.5).position).toEqual(activity.wardrobePose.position);
  const done=mirrorJourneyFrame(j,j.duration+100);expect(done.done).toBe(true);expect(done.position).toEqual(activity.position);
 });
 it('refuses blocked outbound or return routes instead of teleporting through furniture',()=>{
  expect(createMirrorJourney(activity,activity.position,()=>null)).toBeNull();
  let legs=0;
  expect(createMirrorJourney(activity,activity.position,(a,b)=>++legs===2?null:[a,b])).toBeNull();
  expect(legs).toBe(2);
 });
 it('follows all detour segments rather than crossing obstacles',()=>{
  const j=createMirrorJourney(activity,activity.position,(a,b)=>[a,[2,.18,a[2]],[2,.18,b[2]],b]);
  const f=mirrorJourneyFrame(j,2);expect(f.position[0]).toBe(2);expect(f.position[2]).toBeCloseTo(-1.4);
 });
});
