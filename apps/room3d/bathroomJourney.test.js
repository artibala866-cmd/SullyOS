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

describe('live bathtub authored grips',()=>{
 it('offers two nearby, individually reachable palm supports on the actual front rim',()=>{
  const room={id:'bath',items:[{id:'t',assetId:'bath_tub',x:0,y:.18,z:0,rotation:0,stored:false}]};
  const a=bathroomActivities(room,catalog,{body2:true,headWidth:1.2})[0];
  const entry=gamingPoint(room.items[0],[.65,.03,1.35]);
  expect(a.bathHandWorld).toHaveLength(2);
  // The blank rig's left shoulder is the positive local X side of this tub.
  expect(a.bathHandWorld[0][0]).toBeGreaterThan(a.bathHandWorld[1][0]);
  for(const grip of a.bathHandWorld){
   expect(grip[2]).toBeGreaterThan(.5); // The near rim, never the unreachable far rim.
   expect(bathroomRimReachable({...a,bathHandWorld:[grip]},entry,{shoulderHeight:.9,armReach:.65})).toBe(true);
  }
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
   first=bathroomJourneyFrame(j,2.20),second=bathroomJourneyFrame(j,3.11),sit=bathroomJourneyFrame(j,4.55);
  expect(distance(turn.position,j.front)).toBeLessThan(1e-6);
  expect(grip.support).toBeGreaterThan(0);
  expect(first.leadStep).toBeGreaterThan(.5);
  expect(first.trailStep).toBe(0);
  expect(second.trailStep).toBeGreaterThan(.5);
  expect(second.leadStep).toBeGreaterThan(.5); // Keep the first foot above the rim until the trailing foot clears.
  expect(first.seatWeight).toBe(0);
  expect(second.seatWeight).toBe(0);
  expect(sit.seatWeight).toBeGreaterThan(.9);
 });
 it('keeps a near-rim start outside the solid edge before the supported leg lifts',()=>{
  const near=createBathroomJourney(activity,[.9,.18,1.17],0),far=fixture();
  const n=bathroomJourneyFrame(near,1.25),f=bathroomJourneyFrame(far,1.25);
  expect(n.position[2]).toBeGreaterThan(near.edge[2]+.35);
  expect(distance(near.front,n.position)).toBeLessThan(distance(far.front,f.position));
  expect(n.leadTuck).toBe(0);
  expect(distance(bathroomJourneyFrame(near,near.enter).position,near.position)).toBeLessThan(1e-9);
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
   trail=bathroomJourneyFrame(j,3.00),follow=bathroomJourneyFrame(j,3.27);
  expect(lead.leadTuck).toBeGreaterThan(.8);
  expect(lead.leadStep).toBe(0);
  expect(cross.leadTuck).toBeGreaterThan(.8);
  expect(cross.leadStep).toBeGreaterThan(.5);
  expect(trail.trailTuck).toBeGreaterThan(.7);
  expect(trail.trailStep).toBeLessThan(.15);
  expect(follow.trailTuck).toBeGreaterThan(.8);
  expect(follow.trailStep).toBeGreaterThan(.5);
 });
 it('reverses the complete in-tub pivot through the identical safe path',()=>{
  const j=fixture(),duration=j.enter*2+j.hold;
  for(let t=3.4;t<j.enter;t+=.04){
   const entry=bathroomJourneyFrame(j,t),exit=bathroomJourneyFrame(j,duration-t);
   expect(distance(entry.position,exit.position)).toBeLessThan(1e-6);
   expect(Math.abs(entry.rotation-exit.rotation)).toBeLessThan(1e-6);
  }
  const rest=bathroomJourneyFrame(j,j.enter);
  expect(distance(rest.position,j.position)).toBeLessThan(1e-6);
  expect(rest.rotation).toBeCloseTo(j.rotation,6);
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


describe('real bathtub turn/seat shoe clearance',()=>{
 it('keeps both legs tucked until the torso has crossed the front wall and clears before resting',()=>{
  const j=fixture();
  const turn=bathroomJourneyFrame(j,3.54),interior=bathroomJourneyFrame(j,4.08),rest=bathroomJourneyFrame(j,4.6);
  expect(turn.leadTuck).toBeGreaterThan(.85);
  expect(turn.trailTuck).toBeGreaterThan(.85);
  expect(turn.leadStep).toBeGreaterThan(.85);
  expect(turn.trailStep).toBeGreaterThan(.85);
  expect(interior.trailTuck).toBeGreaterThan(.8);
  expect(rest.leadTuck).toBe(0);expect(rest.trailTuck).toBe(0);
  expect(rest.leadStep).toBe(0);expect(rest.trailStep).toBe(0);
  const duration=j.enter*2+j.hold;
  for(const time of [3.54,4.08,4.42,4.6]){
   const entry=bathroomJourneyFrame(j,time),exit=bathroomJourneyFrame(j,duration-time);
   for(const name of ['leadTuck','trailTuck','leadStep','trailStep','seatWeight']){
    expect(exit[name],name+' reverse at '+time).toBeCloseTo(entry[name],8);
   }
  }
 });
});


describe('bathtub seated transfer without an inboard foot-drop rebound',()=>{
 it('settles the pelvis before the high legs untuck and removes excessive backwards root drift',()=>{
  const j=fixture(),last=j.enter*2+j.hold,interior=bathroomJourneyFrame(j,4.08);
  expect(interior.seatWeight).toBeGreaterThan(.8);
  expect(interior.leadTuck).toBeGreaterThan(0);
  const frames=Array.from({length:21},(_,i)=>bathroomJourneyFrame(j,3.6+i*.05));
  for(let i=1;i<frames.length;i++){
   expect(frames[i].seatWeight+1e-8).toBeGreaterThanOrEqual(frames[i-1].seatWeight);
   expect(frames[i].position[2]).toBeGreaterThanOrEqual(j.position[2]-.08);
   expect(frames[i].seatWeight).toBeGreaterThanOrEqual(0);
  }
  for(const t of [3.6,3.9,4.08,4.34]){
   const a=bathroomJourneyFrame(j,t),b=bathroomJourneyFrame(j,last-t);
   expect(b.seatWeight).toBeCloseTo(a.seatWeight,8);
   expect(distance(a.position,b.position)).toBeLessThan(1e-7);
  }
 });
});

describe('bathroom palm release when the body pivots away from the fixed outer rim',()=>{
 it('retains the hold for both foot crossings, eases it before the old grip becomes unreachable, and reverses symmetrically',()=>{
  const j=fixture(),end=2*j.enter+j.hold;
  for(const t of [1.8,2.5,3.2,3.40]){
   expect(bathroomJourneyFrame(j,t).support).toBeGreaterThan(.98);
  }
  const samples=[3.5,3.65,3.8,3.95,4.05,4.08,4.25].map(t=>({t,s:bathroomJourneyFrame(j,t).support}));
  expect(samples[0].s).toBeCloseTo(1,7);
  expect(samples.at(-1).s).toBe(0);
  expect(samples.find(x=>x.t===4.05).s).toBeLessThan(.025);
  for(let i=1;i<samples.length;i++)expect(samples[i].s).toBeLessThanOrEqual(samples[i-1].s+1e-9);
  for(const {t,s} of samples)expect(bathroomJourneyFrame(j,end-t).support).toBeCloseTo(s,8);
  for(const t of [3.5,3.65,3.8,3.95,4.05,4.08]){
   const delta=Math.abs(bathroomJourneyFrame(j,t+.005).support-bathroomJourneyFrame(j,t-.005).support);
   expect(delta).toBeLessThan(.03);
  }
 });
});
