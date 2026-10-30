import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {sampleSelected,type SelectedClip} from '../apps/room3d/chibi/selectedMotions';
import {prepareCarryFrame,carryCaptureWeight} from '../apps/room3d/chibi/princessCarryCapture';

const load=(id:string)=>JSON.parse(readFileSync('public/room3d/motions/selected/'+id+'.json','utf8')) as SelectedClip;
const ids=['home-princess-carry','home-princess-carried'] as const;
describe('two-role captured princess carry and local support IK',()=>{
 it('has real 30 Hz 10-second animations for both roles, not the old identity-only placeholders',()=>{
  for(const id of ids){
   const clip=load(id);
   expect(clip.version).toBe(1);expect(clip.id).toBe(id);expect(clip.duration).toBe(10);
   expect(clip.source).toBe('meshy-text-to-motion');
   expect(clip.actors).toHaveLength(2);
   for(const actor of clip.actors){
    expect(actor.times).toHaveLength(301);
    expect(actor.times[0]).toBe(0);expect(actor.times.at(-1)).toBe(10);
    for(const n of ['hips','spine','chest','head','L_hand','R_hand','L_thigh','R_shin']){
     expect(actor.tracks[n]).toHaveLength(301*4);
     expect(actor.points[n]).toHaveLength(301*3);
    }
    expect(actor.positions).toHaveLength(301*3);
   }
  }
 });
 it('keeps captured torso expression, removes unsupported independent arm controls, and never mutates source tracks',()=>{
  for(const id of ids)for(const track of load(id).actors){
   const raw=sampleSelected(track,4.5),fresh=sampleSelected(track,4.5);
   const capturedSpine=fresh.rotations.spine.clone();
   expect(Object.keys(raw.rotations)).toContain('L_upperArm');
   prepareCarryFrame(raw,4.5);
   expect(raw.position.y).toBe(0);
   for(const n of ['L_upperArm','R_upperArm','L_forearm','R_forearm','L_hand','R_hand'])expect(raw.rotations[n]).toBeUndefined();
   for(const n of ['hips','spine','chest','neck','head']){
    const e=new T.Euler().setFromQuaternion(raw.rotations[n],'YXZ');
    expect(Math.abs(e.x)).toBeLessThan(.231);expect(Math.abs(e.z)).toBeLessThan(.231);
   }
   expect(raw.rotations.spine.angleTo(new T.Quaternion())).toBeGreaterThan(0);
   expect(fresh.rotations.spine.angleTo(capturedSpine)).toBeLessThan(1e-12);
   expect(fresh.rotations.L_hand).toBeDefined();
   expect(fresh.position.y).not.toBe(0);
  }
 });
 it('blends capture into authored carry/landing without a hard endpoint snap',()=>{
  expect(carryCaptureWeight(0)).toBe(0);
  expect(carryCaptureWeight(1.5)).toBeCloseTo(1);
  expect(carryCaptureWeight(5)).toBeCloseTo(1);
  expect(carryCaptureWeight(10)).toBe(0);
  for(const t of [.1,1,9.05,9.95]){
   expect(Math.abs(carryCaptureWeight(t-.001)-carryCaptureWeight(t+.001))).toBeLessThan(.01);
  }
 });
});
