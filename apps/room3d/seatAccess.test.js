import {describe,it,expect} from 'vitest';
import {seatEntry,seatEntryCandidates} from './seatChange.js';

const seat={position:[0,.78,0],rotation:0};
const free=(x,z)=>Math.abs(x)<2.5&&Math.abs(z)<2.5;
describe('reusable seat approach and safe get-up route',()=>{
 it('prefers the furniture front when it is actually clear',()=>{
  const p=seatEntry(seat,{free},[0,0],{allowSides:true});
  expect(p).toEqual([0,.18,.45]);
 });
 it('finds a flank when a desk blocks the entire front',()=>{
  const map={free:(x,z)=>free(x,z)&&z<=0};
  expect(seatEntry(seat,map,[0,0])).toBeNull();
  const alternate=seatEntry(seat,map,[0,0],{allowSides:true});
  expect(alternate).not.toBeNull();
  expect(alternate[0]).not.toBeCloseTo(0);
  expect(alternate[2]).toBeLessThanOrEqual(0);
 });
 it('does not manufacture an entry or use a blocked cached exit when all sides are obstructed',()=>{
  const blocked={free:()=>false};
  expect(seatEntry(seat,blocked,[0,0],{allowSides:true,preferred:[.9,.18,0]})).toBeNull();
  const map={free:(x,z)=>Math.abs(x)>.8&&z<.2};
  expect(seatEntry(seat,map,[0,0],{allowSides:true,preferred:[0,.18,.6]})[0]).not.toBe(0);
 });
 it('uses the original verified standing endpoint when still free',()=>{
  const preferred=[1.1,.18,.12];
  expect(seatEntry(seat,{free},[0,0],{allowSides:true,preferred})).toEqual(preferred);
 });
 it('keeps workstation entrances beside the chair instead of across its desk',()=>{
  const points=seatEntryCandidates(seat,{allowSides:true,allowFront:false});
  expect(points).toHaveLength(24);
  expect(points.every(p=>Math.abs(p[0])>.01)).toBe(true);
  const docked=seatEntry(seat,{free:(x,z)=>Math.abs(x)>.5&&Math.abs(z)<2},[0,0],{allowSides:true,sideFirst:true});
  expect(docked).not.toBeNull();
  expect(Math.abs(docked[0])).toBeGreaterThan(.5);
 });
 it('is invariant to a rotated seat model and does not assume a named gaming chair',()=>{
  const transform={position:[1,.65,2],rotation:Math.PI/2};
  const p=seatEntryCandidates(transform,{allowSides:true,sideFirst:true});
  expect(p).toHaveLength(41);
  expect(p[0][0]).toBeCloseTo(1);
  expect(p[0][2]).toBeCloseTo(2.9);
  expect(p.some(q=>Math.abs(q[0]-1)>.4)).toBe(true);
 });
});
