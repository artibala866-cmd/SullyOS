import {describe,expect,it} from 'vitest';
import {clearSocialObservers,SOCIAL_OBSERVER_CLEARANCE} from './socialSpace.js';
describe('social action feasibility',()=>{
 it('uses a core-body radius rather than a very large head-footprint radius',()=>{
  expect(SOCIAL_OBSERVER_CLEARANCE).toBe(.60);
  expect(clearSocialObservers([[{x:.7,z:0}]],[{x:0,z:0}])).toBe(true);
  expect(clearSocialObservers([[{x:.4,z:0}]],[{x:0,z:0}])).toBe(false);
 });
 it('handles an empty room and checks each waypoint',()=>{
  expect(clearSocialObservers([[{x:.2,z:0}]],[])).toBe(true);
  expect(clearSocialObservers([[{x:1,z:0},{x:.59,z:0}]],[{x:0,z:0}])).toBe(false);
 });
});
