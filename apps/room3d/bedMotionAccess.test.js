import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import catalog from '../../public/room3d/catalog.json';
import {roomBeds,seatTransform} from './seating.js';
import {bedEntry,bedEdge,bedChangePose} from './bedMotion.js';
import {seatChangeDuration} from './chibi/roomMotionFrame.ts';

const room={id:'bedroom',items:[
 {id:'single-bed',assetId:'bedroom_single_bed',x:0,y:.18,z:0,rotation:0,stored:false}
]};
const slot=roomBeds(room,catalog).find(b=>b.itemId==='single-bed'&&b.seatId==='center');
const legacy=()=>seatTransform(room,catalog,slot,false);

describe('shared bed access for legacy and skeletal residents',()=>{
 it('resolves a legacy bed slot to a bed pose with the reviewed edge profile',()=>{
  const pose=legacy();
  expect(pose?.pose).toBe('bed');
  expect(pose?.bed?.edgeX).toBeGreaterThan(0);
  expect(pose?.bed?.center).toEqual([0,.18,0]);
  expect(pose?.bed?.entry).not.toBe(false);
 });
 it('tries the opposite mattress side if the preferred side is blocked',()=>{
  const pose=legacy();
  const front=bedEntry(pose,{free:(x)=>x<-.5},[0,0]);
  expect(front).not.toBeNull();
  expect(front[0]).toBeLessThan(-1);
 });
 it('reuses the exact entry point for rising and fails closed if that exit becomes blocked',()=>{
  const pose=legacy(),remembered=[1.6,.18,-.08625];
  expect(bedEntry(pose,{free:(x)=>x>0},[0,0],{preferred:remembered,allowAlternate:false})).toEqual(remembered);
  // The opposite side is open, but crossing the mattress to it is not a safe fallback.
  expect(bedEntry(pose,{free:(x)=>x<0},[0,0],{preferred:remembered,allowAlternate:false})).toBeNull();
 });
 it('uses a finite, continuous root path for lying down and standing up',()=>{
  const pose=legacy(),front=bedEntry(pose,{free:(x)=>x>.5},[0,0]);
  expect(front).not.toBeNull();
  const change={rising:false,front,edge:bedEdge(pose,front),seat:[pose.position[0],pose.position[1]+.34,pose.position[2]],rotation:pose.rotation,startRotation:0,pose:'bed'};
  const duration=seatChangeDuration('bed'),start=bedChangePose(change,0),finish=bedChangePose(change,duration);
  expect(start.position.every(Number.isFinite)).toBe(true);
  expect(finish.position.every(Number.isFinite)).toBe(true);
  expect(start.position[0]).toBeCloseTo(front[0]);
  expect(start.position[1]).toBeCloseTo(front[1]);
  expect(finish.position[0]).toBeCloseTo(change.seat[0]);
  expect(finish.position[1]).toBeCloseTo(change.seat[1]);
  const rise=bedChangePose({...change,rising:true},0),stand=bedChangePose({...change,rising:true},duration);
  expect(rise.position[0]).toBeCloseTo(change.seat[0]);
  expect(stand.position[0]).toBeCloseTo(front[0]);
  expect(stand.position[1]).toBeCloseTo(front[1]);
 });
 it('keeps the non-skeletal action on the checked walk-in path, not the old direct snap',()=>{
  const source=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  expect(source).toContain("const bedProfile=seatTransform(placementRoom(),catalog,bed,!!visitor?.rig)?.bed;");
  expect(source).toContain("approachBed(bed,d.recordSource);return;");
  expect(source).not.toContain("visitorSeat=bed;visitorMotion=bed.bedMode?'idle':'sleep';visitorStart=elapsed;visitorUntil=elapsed+4.4;beginSeatChange(false);");
  expect(source).toContain("if(visitorSeat&&(visitor?.rig||visitorSeat.bed)&&!beginSeatChange(true))");
  expect(source).toContain('parkedSeatAccess:seatAccess');
  expect(source).toContain('seatAccess=snapshot?.parkedSeatAccess||null');
  expect(source).toContain('visitorSeat=null;seatAccess=null;visitorPlant=null');
 });
});
