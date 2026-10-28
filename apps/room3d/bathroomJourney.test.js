import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createBathroomJourney,bathroomJourneyFrame,bathroomHandTargets,bathroomRimReachable} from './bathroomJourney.js';

const activity={
 kind:'bath-soak',position:[.32,.54,.12],rotation:Math.PI/2,
 edge:[.72,1.1,.65],edgeRotation:0,posture:'seated',duration:8
};
const fixture=()=>createBathroomJourney(activity,[.9,.18,1.7],0);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const expectContinuous=(a,b)=>expect(distance(a.position,b.position)).toBeLessThan(.15);

describe('bathroom interaction cancellation reverses actual partial path',()=>{
 for(const [label,elapsed] of [['early entry',.65],['mid-entry',2.2],['working',7.3],['already exiting',12.2]]){
  it('does not snap a resident when cancelled during '+label,()=>{
   const j=fixture();
   const before=bathroomJourneyFrame(j,elapsed);
   j.cancelElapsed=elapsed;
   const at=bathroomJourneyFrame(j,elapsed);
   expect(distance(before.position,at.position)).toBeLessThan(1e-6);
   const remain=elapsed<j.enter?elapsed:elapsed<j.enter+j.hold?j.enter:Math.max(0,j.enter*2+j.hold-elapsed);
   const next=bathroomJourneyFrame(j,elapsed+.03);
   expectContinuous(at,next);
   const done=bathroomJourneyFrame(j,elapsed+remain);
   expect(done.done).toBe(true);
   expect(distance(done.position,j.front)).toBeLessThan(1e-6);
   expect(done.position.every(Number.isFinite)).toBe(true);
  });
 }
 it('keeps the original full enter-hold-exit path until cancellation is requested',()=>{
  const j=fixture(),t=j.enter*2+j.hold;
  expect(bathroomJourneyFrame(j,j.enter+.1).phase).toBe('work');
  const done=bathroomJourneyFrame(j,t);
  expect(done.done).toBe(true);
  expect(distance(done.position,j.front)).toBeLessThan(1e-6);
 });
 it('does not clear the active bathroom state as soon as stop is clicked',()=>{
  const src=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  expect(src).toContain('j.cancelElapsed=Math.max(0,elapsed-visitorStart)');
  expect(src).toContain("message='正在安全离开卫浴家具'");
  expect(src).toContain("if(visitorSeat&&['chibi-hug','chibi-kitchen','chibi-mirror','chibi-bath','fridge-toggle'].includes(d.action))");
 });
});

describe('authored tub rim contact and reversible leg crossing',()=>{
 it('never treats the high rim as a root elevation target',()=>{
  const j=fixture(),samples=Array.from({length:121},(_,i)=>bathroomJourneyFrame(j,i*j.enter/120));
  const ys=samples.map(f=>f.position[1]);
  expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(j.front[1],j.position[1])+1e-6);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(j.front[1],j.position[1])-1e-6);
  expect(Math.max(...ys)).toBeLessThan(j.edge[1]-.3);
  expect(distance(samples[0].position,j.front)).toBeLessThan(1e-6);
  expect(distance(samples.at(-1).position,j.position)).toBeLessThan(1e-6);
 });
 it('plants the first approach, grips the rim and steps one leg at a time before sitting',()=>{
  const j=fixture(),turn=bathroomJourneyFrame(j,.25),grip=bathroomJourneyFrame(j,.84),
   first=bathroomJourneyFrame(j,1.50),second=bathroomJourneyFrame(j,2.28),sit=bathroomJourneyFrame(j,3.55);
  expect(distance(turn.position,j.front)).toBeLessThan(1e-6);
  expect(grip.support).toBeGreaterThan(0);
  expect(first.leadStep).toBeGreaterThan(.5);
  expect(first.trailStep).toBe(0);
  expect(second.trailStep).toBeGreaterThan(.5);
  expect(second.leadStep).toBeLessThan(.5);
  expect(first.seatWeight).toBe(0);
  expect(second.seatWeight).toBe(0);
  expect(sit.seatWeight).toBeGreaterThan(.9);
 });
 it('keeps both palm contacts fixed in room space across entering, yaw and exit',()=>{
  const a={...activity,bathHandWorld:[[.72,1.16,.52],[.72,1.16,-.52]]};
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
   const j=createBathroomJourney({...a,rotation:yaw,edgeRotation:yaw},[.9,.18,1.7],-Math.PI+.02);
   for(const t of [.2,.9,1.6,2.4,3.3,j.enter+.2,j.enter+j.hold+1.9]){
    const f=bathroomJourneyFrame(j,t),targets=bathroomHandTargets(a,f);
    targets.forEach(([lx,ly,lz],i)=>{
     const [x,y,z]=a.bathHandWorld[i],c=Math.cos(f.rotation),s=Math.sin(f.rotation);
     expect(distance([f.position[0]+c*lx+s*lz,f.position[1]+ly,f.position[2]-s*lx+c*lz],[x,y,z])).toBeLessThan(1e-6);
    });
   }
  }
 });
 it('refuses out-of-reach or missing authored grips but does not invent anchors',()=>{
  const a={...activity,bathHandWorld:[[.65,1.16,.52]]};
  expect(bathroomRimReachable(a,[.65,.18,1.35],{shoulderHeight:.9,armReach:.65})).toBe(true);
  expect(bathroomRimReachable(a,[.65,.18,4.5],{shoulderHeight:.9,armReach:.65})).toBe(false);
  expect(bathroomRimReachable(activity,[.65,.18,1.35],{shoulderHeight:.9,armReach:.65})).toBe(false);
 });
 for(const fps of [15,30,60]){
  it('preserves root position and phase progression at '+fps+' fps including reverse exit',()=>{
   const j=fixture(),dt=1/fps,end=j.enter*2+j.hold,frames=[];
   for(let t=0;t<end;t+=dt)frames.push(bathroomJourneyFrame(j,t));
   frames.push(bathroomJourneyFrame(j,end));
   for(let i=1;i<frames.length;i++){
    expect(distance(frames[i].position,frames[i-1].position)).toBeLessThan(.20);
    const angle=frames[i].rotation-frames[i-1].rotation;
    expect(Math.abs(Math.atan2(Math.sin(angle),Math.cos(angle)))).toBeLessThan(.3);
   }
   expect(frames.at(-1).done).toBe(true);
  });
 }
});
