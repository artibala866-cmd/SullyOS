import {describe,expect,it} from 'vitest';
import {residentSeparationStep} from './residentSeparation.js';

const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
describe('resident body shells',()=>{
 it('does nothing when residents do not overlap',()=>{
  expect(residentSeparationStep([1.2,0],[0,0],{minimum:1})).toBeNull();
 });
 it('pushes an overlapping standing actor outward by a bounded step',()=>{
  const from=[.34,0],anchor=[0,0];
  const next=residentSeparationStep(from,anchor,{minimum:1,maxStep:.08});
  expect(next).not.toBeNull();
  expect(distance(next,anchor)).toBeGreaterThan(distance(from,anchor));
  expect(distance(next,from)).toBeLessThanOrEqual(.081);
 });
 it('resolves exact co-location without NaN or a teleport',()=>{
  const next=residentSeparationStep([0,0],[0,0],{minimum:1,maxStep:.07});
  expect(next).not.toBeNull();
  expect(next.every(Number.isFinite)).toBe(true);
  expect(distance(next,[0,0])).toBeLessThanOrEqual(.071);
 });
 it('tries a safe tangent if the direct escape path hits furniture',()=>{
  const next=residentSeparationStep([.4,0],[0,0],{
   minimum:1,maxStep:.12,
   free:(x,z)=>Math.abs(z)>.04,
  });
  expect(next).not.toBeNull();
  expect(Math.abs(next[1])).toBeGreaterThan(.04);
  expect(distance(next,[0,0])).toBeGreaterThan(.4);
 });
 it('does not force a body through an entirely blocked wall',()=>{
  expect(residentSeparationStep([.4,0],[0,0],{
   minimum:1,maxStep:.1,free:()=>false,
  })).toBeNull();
 });
 it('allows a short outward step from a sofa clearance buffer only when its exit is safe',()=>{
  const from=[0,0],anchor=[-.2,0];
  const next=residentSeparationStep(from,anchor,{
   minimum:1,maxStep:.08,
   free:(x,z)=>x>.85,
  });
  expect(next).not.toBeNull();
  expect(distance(next,anchor)).toBeGreaterThan(distance(from,anchor));
  expect(distance(next,from)).toBeLessThanOrEqual(.081);
 });
 it('rejects malformed or unbounded corrections',()=>{
  expect(residentSeparationStep([NaN,0],[0,0])).toBeNull();
  expect(residentSeparationStep([0,0],[0,0],{maxStep:0})).toBeNull();
 });
});
