import {walkingMap} from './navigation.js';
import {describe,expect,it} from 'vitest';
import {clearSocialObservers,SOCIAL_OBSERVER_CLEARANCE,createSocialSpaceCheck} from './socialSpace.js';
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

describe('live social room collision',()=>{
 it('includes furniture and refreshes moved/stored furniture after a layout revision',()=>{
  const catalog=[{id:'cabinet',boxes:[[-.2,0,-.6,.2,2,.6]]}];
  const item={id:'c',assetId:'cabinet',x:0,y:0,z:0,rotation:0,stored:false};
  const home={rooms:[{id:'r',x:0,z:0,level:0,items:[item]}]};
  let revision=0,builds=0;
  const check=createSocialSpaceCheck({getRevision:()=>revision,getObservers:()=>[],getMap:()=>{builds++;return walkingMap(home,0,catalog,{walkClearance:true});}});
  expect(check([[{x:0,z:0}]])).toBe(false);
  expect(check([[{x:2,z:0}]])).toBe(true);
  expect(builds).toBe(1);
  item.x=2;revision++;
  expect(check([[{x:0,z:0}]])).toBe(true);
  expect(check([[{x:2,z:0}]])).toBe(false);
  item.stored=true;revision++;
  expect(check([[{x:2,z:0}]])).toBe(true);
  expect(builds).toBe(3);
 });
 it('checks segment interiors, live observers and room-to-world offsets without rebuilding each frame',()=>{
  let observers=[],builds=0;
  const check=createSocialSpaceCheck({offset:{x:10,z:20},getRevision:()=>0,getMap:()=>{builds++;return {free:(x,z)=>!(x>10.45&&x<10.55&&z===20)};},getObservers:()=>observers});
  expect(check([[{x:0,z:0},{x:1,z:0}]])).toBe(false);
  expect(check([[{x:0,z:1},{x:1,z:1}]])).toBe(true);
  observers=[{x:.5,z:1}];
  expect(check([[{x:0,z:1},{x:1,z:1}]])).toBe(false);
  observers=[];
  expect(check([[{x:0,z:1},{x:1,z:1}]])).toBe(true);
  expect(builds).toBe(1);
 });
});
