import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createBathroomJourney,bathroomJourneyFrame} from './bathroomJourney.js';

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
