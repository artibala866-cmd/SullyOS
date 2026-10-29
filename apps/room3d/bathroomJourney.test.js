import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import catalog from '../../public/room3d/catalog.json';
import {bathroomActivities} from './bathroom.js';
import {gamingPoint} from './gaming.js';
import {createBathroomJourney,bathroomJourneyFrame,bathroomHandTargets,bathroomRimReachable,bathroomJourneyObstacleIssue} from './bathroomJourney.js';

const activity={
 kind:'bath-soak',position:[.32,.54,.12],rotation:Math.PI/2,
 edge:[.72,1.1,.65],edgeRotation:0,posture:'seated',duration:8
};
const fixture=()=>createBathroomJourney(activity,[.9,.18,1.7],0);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const expectContinuous=(a,b)=>expect(distance(a.position,b.position)).toBeLessThan(.15);

describe('bathroom interaction cancellation reverses actual partial path',()=>{
 for(const [label,elapsed] of [['early entry',.65],['mid-entry',2.2],['working',7.3],['already exiting',13.5]]){
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
 it('hoists pelvis only after rim grip and returns smoothly to original seated level',()=>{
  const j=fixture(),before=bathroomJourneyFrame(j,1.2),
   handBraced=bathroomJourneyFrame(j,1.95),
   firstTransfer=bathroomJourneyFrame(j,2.35),
   secondTransfer=bathroomJourneyFrame(j,3.18),
   seated=bathroomJourneyFrame(j,j.enter);
  expect(before.position[1]).toBe(j.front[1]);
  expect(handBraced.position[1]).toBeGreaterThan(j.front[1]+.20);
  expect(handBraced.support).toBeGreaterThan(.7);
  expect(firstTransfer.position[1]).toBeLessThan(j.edge[1]-.2);
  expect(secondTransfer.position[1]).toBeLessThan(j.edge[1]-.2);
  expect(seated.position[1]).toBeCloseTo(j.position[1],6);
 });
 it('plants the first approach, grips the rim and steps one leg at a time before sitting',()=>{
  const j=fixture(),turn=bathroomJourneyFrame(j,.25),grip=bathroomJourneyFrame(j,.84),
   first=bathroomJourneyFrame(j,2.20),second=bathroomJourneyFrame(j,3.04),sit=bathroomJourneyFrame(j,4.55);
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
 it('alternates actual support feet during the final approach before the rim crossing',()=>{
  const j=fixture(),left=bathroomJourneyFrame(j,.55),transfer=bathroomJourneyFrame(j,.83),
   right=bathroomJourneyFrame(j,1.04),cross=bathroomJourneyFrame(j,1.98);
  expect(left.supportFoot).toBe('R');
  expect(left.approachStep).toBeGreaterThan(.7);
  expect(left.approachTrailStep).toBe(0);
  expect(transfer.supportFoot).toBe('L');
  expect(right.supportFoot).toBe('L');
  expect(right.approachTrailStep).toBeGreaterThan(.5);
  expect(right.approachStep).toBe(0);
  expect(cross.supportFoot).toBe(null);
  expect(cross.leadStep).toBeGreaterThan(0);
  expect(cross.approachTrailStep).toBe(0);
  expect(left.position[1]).toBe(j.front[1]);
  expect(right.position[1]).toBe(j.front[1]);
  const earlyDistance=distance(j.front,left.position),laterDistance=distance(j.front,right.position);
  expect(laterDistance).toBeGreaterThan(earlyDistance);
  expect(earlyDistance).toBeLessThan(distance(j.front,j.position)*.17);
 });
 it('tucks each leg above the rim before swinging it across the bathtub',()=>{
  const j=fixture(),lead=bathroomJourneyFrame(j,1.69),cross=bathroomJourneyFrame(j,2.19),
   trail=bathroomJourneyFrame(j,2.83),follow=bathroomJourneyFrame(j,3.17);
  expect(lead.leadTuck).toBeGreaterThan(.8);
  expect(lead.leadStep).toBe(0);
  expect(cross.leadTuck).toBeGreaterThan(.8);
  expect(cross.leadStep).toBeGreaterThan(.5);
  expect(trail.trailTuck).toBeGreaterThan(.7);
  expect(trail.trailStep).toBe(0);
  expect(follow.trailTuck).toBeGreaterThan(.8);
  expect(follow.trailStep).toBeGreaterThan(.5);
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

describe('bathtub swept room clearance is checked before entering',()=>{
 for(const rotation of [0,90,180,270]){
  it('rejects an unrelated obstacle for a '+rotation+' degree bathtub without disabling the tub itself',()=>{
   const tub={id:'tub',assetId:'bath_tub',x:0,y:.18,z:0,rotation,stored:false};
   const room={id:'bath',items:[tub]};
   const action=bathroomActivities(room,catalog,{body2:true,headWidth:1.2}).find(a=>a.kind==='bath-soak');
   expect(action).toBeDefined();
   const entry=gamingPoint(tub,[.65,0,1.35]),journey=createBathroomJourney(action,entry,rotation*Math.PI/180);
   expect(bathroomJourneyObstacleIssue(room,catalog,action,journey,1.2)).toBe('');
   const obstacle=gamingPoint(tub,[.65,0,1.30]);
   room.items.push({id:'other-chair',assetId:'chair',x:obstacle[0],y:.18,z:obstacle[2],rotation,stored:false});
   expect(bathroomJourneyObstacleIssue(room,catalog,action,journey,1.2)).toContain('路线被挡住');
  });
 }
});

it('keeps unsupported legacy tub climbing closed without disabling standing bathroom devices',()=>{
 const room={id:'bath',items:[
  {id:'tub',assetId:'bath_tub',x:0,y:.18,z:0,rotation:0,stored:false},
  {id:'washer',assetId:'bath_washer',x:2,y:.18,z:0,rotation:0,stored:false}
 ]};
 const legacy=bathroomActivities(room,catalog,{body2:false});
 expect(legacy.find(a=>a.kind==='bath-soak')?.reason).toContain('安全跨浴缸');
 expect(legacy.find(a=>a.kind==='bath-laundry')?.reason??'').not.toContain('安全跨浴缸');
 const skeletal=bathroomActivities(room,catalog,{body2:true});
 expect(skeletal.find(a=>a.kind==='bath-soak')?.reason??'').not.toContain('安全跨浴缸');
});
