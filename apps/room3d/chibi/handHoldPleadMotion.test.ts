import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {furnitureHandRotation} from './furnitureMotion';
import {selectedMotions,sampleSelected} from './selectedMotions';
import {socialActions} from './selectedSocial';
import {isIntimacy} from './intimacyMotion';
import {
 handHoldPleadPhase,pleadHandSwingOffset,pleadHandSides,pleadStandingPoint,pleadContactTarget,
 pleadPalmContact,
} from './handHoldPleadMotion';
import clip from '../../../public/room3d/motions/selected/home-hand-hold-plead.json';

describe('6.7-second two-person hand-hold pleading',()=>{
 it('adds only a paired intimate action on the original player and clip cache',()=>{
  const entry=selectedMotions.find(x=>x.id==='home-hand-hold-plead');
  expect(entry?.label).toBe('牵手撒娇');
  expect(entry?.category).toBe('close');
  expect(entry?.participants).toBe(2);
  expect(entry?.duration).toBe(6.7);
  expect(socialActions['home-hand-hold-plead'].duration).toBe(6.7);
  expect(isIntimacy('home-hand-hold-plead')).toBe(true);
  expect(clip.version).toBe(1);
  expect(clip.id).toBe(entry?.id);
  expect(clip.actors).toHaveLength(2);
  for(const actor of clip.actors){
   expect(actor.times).toEqual([0,6.7]);
   expect(sampleSelected(actor,3).rotations.hips).toEqual(new T.Quaternion());
  }
 });
 it('stands A on either B front flank; B stays exactly where they were',()=>{
  for(const yaw of [0,Math.PI/2,-1.2])for(const sign of [1,-1] as const){
   const b=new T.Vector3(3,.18,-2);
   const rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw);
   const point=pleadStandingPoint(b,rotation,sign);
   const local=point.clone().sub(b).applyQuaternion(rotation.clone().invert());
   expect(local.z).toBeCloseTo(.76);
   expect(local.x).toBeCloseTo(sign*.26);
   expect(point.distanceTo(b)).toBeCloseTo(Math.hypot(.76,.26));
   expect(b).toEqual(new T.Vector3(3,.18,-2));
   expect(pleadHandSides(sign)).toEqual(sign===1?['R','L']:['L','R']);
  }
 });
 it('has distinct playful waves, delayed response, toe point, pause and gentle release',()=>{
  const early=handHoldPleadPhase(.90),lead=handHoldPleadPhase(1.32);
  const reply=handHoldPleadPhase(1.32),point=handHoldPleadPhase(3.78);
  expect(early.grip).toBeGreaterThan(0);
  expect(early.reply).toBe(0);
  expect(reply.reply).toBeLessThan(1);
  expect(lead.grip).toBeGreaterThan(reply.reply);
  expect(handHoldPleadPhase(1.93).first).toBeGreaterThan(.95);
  expect(handHoldPleadPhase(1.93).last).toBe(0);
  expect(point.toe).toBeGreaterThan(.95);
  expect(point.tug).toBeGreaterThan(0);
  expect(handHoldPleadPhase(5.12).last).toBeGreaterThan(.95);
  expect(handHoldPleadPhase(5.12).toe).toBe(0);
  expect(handHoldPleadPhase(5.95).swing).toBeCloseTo(0);
  expect(handHoldPleadPhase(6.7).grip).toBe(0);
  expect(handHoldPleadPhase(6.7).reply).toBe(0);
 });
 it('actually sweeps the paired palms wide and back twice, not stationary wrists',()=>{
  for(const sign of [1,-1] as const)for(const scale of [.65,1,1.6]){
   const rest=pleadHandSwingOffset(1.48,sign,scale);
   const first=pleadHandSwingOffset(1.93,sign,scale);
   const close=pleadHandSwingOffset(2.27,sign,scale);
   const again=pleadHandSwingOffset(2.59,sign,scale);
   const final=pleadHandSwingOffset(5.12,sign,scale);
   expect(rest.length()).toBeLessThan(.001);
   expect(Math.abs(first.x)).toBeGreaterThan(.18*scale);
   expect(Math.abs(again.x)).toBeGreaterThan(.14*scale);
   expect(Math.abs(final.x)).toBeGreaterThan(.13*scale);
   expect(Math.abs(close.x)).toBeLessThan(.001);
   expect(first.x*sign).toBeGreaterThan(0);
   // Movement is fluid: small differences at the start/end of each excursion.
   const x0=pleadHandSwingOffset(1.53,sign,scale).x;
   const x1=pleadHandSwingOffset(1.54,sign,scale).x;
   const x2=pleadHandSwingOffset(1.92,sign,scale).x;
   expect(Math.abs(x1-x0)).toBeLessThan(.001);
   expect(Math.abs(first.x-x2)).toBeLessThan(.001);
  }
 });
 it('respects both arm lengths without making the grasp stop at the first sweep',()=>{
  const shoulderA=new T.Vector3(-.45,1.2,0),shoulderB=new T.Vector3(.45,1.2,0);
  const stationary=pleadContactTarget(shoulderA,.9,shoulderB,.9);
  const opened=pleadContactTarget(shoulderA,.9,shoulderB,.9,new T.Vector3(0,0,.20));
  expect(opened.point.distanceTo(stationary.point)).toBeGreaterThan(.12);
  expect(opened.point.distanceTo(shoulderA)).toBeLessThan(.9);
  expect(opened.point.distanceTo(shoulderB)).toBeLessThan(.9);
  const limited=pleadContactTarget(shoulderA,.55,shoulderB,.55,new T.Vector3(0,0,1));
  expect(limited.appliedWave).toBeLessThan(.5);
  expect(limited.point.distanceTo(shoulderA)).toBeLessThanOrEqual(.55*.93+.001);
  expect(limited.point.distanceTo(shoulderB)).toBeLessThanOrEqual(.55*.93+.001);
 });
 it('uses one shared reachable anchor for both hands at equal or different heights',()=>{
  for(const y of [0,.25,.8]){
   const a=new T.Vector3(.2,1,0),b=new T.Vector3(.45,1+y,-.5);
   const target=pleadContactTarget(a,.8,b,.9);
   expect(target.reachable).toBe(true);
   expect(target.point.distanceTo(a)).toBeLessThanOrEqual(.8+.001);
   expect(target.point.distanceTo(b)).toBeLessThanOrEqual(.9+.001);
   expect(Number.isFinite(target.deficit)).toBe(true);
  }
  const a=new T.Vector3(0,0,0),b=new T.Vector3(0,2,0);
  const unreachable=pleadContactTarget(a,.35,b,.35);
  expect(unreachable.reachable).toBe(false);
  expect(unreachable.deficit).toBeGreaterThan(1);
  expect(unreachable.point.y).toBeGreaterThan(0);
  expect(unreachable.point.y).toBeLessThan(2);
 });
 it('faces actual palms towards each other on either side, through all yaw angles',()=>{
  for(const yaw of [0,.8,-1.5])for(const sign of [1,-1] as const){
   const hands=pleadHandSides(sign);
   const rootA=new T.Group(),rootB=new T.Group();
   rootB.rotation.y=yaw;
   rootA.rotation.y=yaw+Math.PI;
   rootA.updateWorldMatrix(true,true);
   rootB.updateWorldMatrix(true,true);
   const a={root:rootA} as ChibiVisitor,b={root:rootB} as ChibiVisitor;
   const front=new T.Vector3(0,0,1).applyQuaternion(rootB.quaternion);
   const target=new T.Vector3(0,.95,0);
   const ca=pleadPalmContact(a,hands[0],target,front,.28);
   const cb=pleadPalmContact(b,hands[1],target,front.clone().negate(),.26);
   const qa=furnitureHandRotation(hands[0],ca.direction.toArray(),ca.normal.toArray());
   const qb=furnitureHandRotation(hands[1],cb.direction.toArray(),cb.normal.toArray());
   const palmA=new T.Vector3(0,-1,0).applyQuaternion(qa);
   const palmB=new T.Vector3(0,-1,0).applyQuaternion(qb);
   expect(palmA.dot(palmB)).toBeLessThan(-.999);
   expect(palmA.dot(front)).toBeLessThan(-.999);
   expect(palmB.dot(front)).toBeGreaterThan(.999);
  }
 });
});
