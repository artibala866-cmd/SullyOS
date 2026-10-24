import {describe,expect,it} from 'vitest';
import {findWalkPath} from './navigation.js';
import {residentBlocksStep,withResidents} from './residentNavigation.js';
describe('bounded room path fallback and body clearance',()=>{
 it('finds a physically clear narrow passage even when the .2 lattice misses it',()=>{
  const map={free:(x,z)=>Math.abs(x)<=.21&&Math.abs(z)<=.8&&!(Math.abs(z)<.1&&Math.abs(x-.1)>.045)};
  const route=findWalkPath(map,[0,-.6],[0,.6]);
  expect(route).not.toBeNull();
  expect(route[0]).toEqual([0,-.6]);expect(route.at(-1)).toEqual([0,.6]);
  expect(route.some(p=>Math.abs(p[0]-.1)<.051)).toBe(true);
 });
 it('never crosses continuous solid partitions',()=>{
  const map={free:(x,z)=>Math.abs(x)<=.8&&Math.abs(z)<=.8&&Math.abs(x)>.05};
  expect(findWalkPath(map,[-.4,0],[.4,0])).toBeNull();
 });
 it('recovers margin-only starting poses but not a body embedded in furniture',()=>{
  const map={free:(x,z)=>x>=.25&&x<1&&Math.abs(z)<1,cells:[[0,-1,1,1]],obstacles:[]};
  const route=findWalkPath(map,[.07,0],[.8,0]);
  expect(route?.[0]).toEqual([.07,0]);expect(route?.at(-1)).toEqual([.8,0]);
  expect(findWalkPath({...map,obstacles:[[0,0,-.1,.2,2,.1]]},[.07,0],[.8,0])).toBeNull();
 });
 it('does not blindly snap exact blocked furniture targets',()=>{
  const map={free:(x,z)=>x>=-.8&&x<=.75&&Math.abs(z)<=.8};
  expect(findWalkPath(map,[0,0],[.9,0])).toBeNull();
  expect(findWalkPath(map,[0,0],[.9,0],{targetRadius:.3})).not.toBeNull();
 });
 it('aligns route clearance with live resident sweep blocking',()=>{
  const map=withResidents({free:()=>true},[[0,0]],[.3,0]);
  expect(map.free(.31,0)).toBe(true);
  expect(map.free(.1,0)).toBe(false);
  expect(map.free(-.45,0)).toBe(false);
  expect(map.free(.65,0)).toBe(true);
  expect(residentBlocksStep([.6,0],[.4,0],[[0,0]])).toBe(true);
 });
});
