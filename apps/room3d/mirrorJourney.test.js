import {describe,it,expect} from 'vitest';
import {createMirrorJourney,mirrorJourneyFrame} from './mirrorJourney.js';

describe('wardrobe mirror path continuity',()=>{
 const activity={position:[1,.18,0],rotation:0,wardrobePose:{position:[-1,.18,0],rotation:Math.PI}};
 it('refuses to jump through obstacles when any wardrobe or mirror leg is unreachable',()=>{
  expect(createMirrorJourney(activity,[0,.18,1],()=>null)).toBeNull();
  let count=0;
  expect(createMirrorJourney(activity,[0,.18,1],()=>++count===2?null:[[0,.18,1],[1,.18,0]])).toBeNull();
 });
 it('returns a time-parametrized path when each leg is traversable',()=>{
  const j=createMirrorJourney(activity,[0,.18,1],(from,to)=>[from,to],{speed:1});
  expect(j.duration).toBeGreaterThan(10);
  expect(mirrorJourneyFrame(j,j.duration).done).toBe(true);
  expect(j.phases.some(p=>p.teleported)).toBe(false);
 });
});
