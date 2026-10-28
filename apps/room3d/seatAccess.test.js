import {describe,it,expect} from 'vitest';
import {seatEntry,seatEntryCandidates,seatChangePose,seatTransitionDuration} from './seatChange.js';
import {seatChangeDuration} from './chibi/roomMotionFrame.ts';
import {readFileSync} from 'node:fs';

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

// The root transition is shared by the skeletal and former directly-snapping
// legacy chibi. Source assertions only prove wiring, never 3D contact quality.
describe('legacy seated motion follows the shared physical entry/exit',()=>{
 it('moves continuously between the reached standing socket and cushion anchor',()=>{
  const front=[0,.18,.7],chair={pose:'chair',front,seat:[0,.68,0],rotation:0,startRotation:0};
  const duration=seatTransitionDuration('chair',front,chair.seat);
  for(const rising of [false,true]){
   const change={...chair,rising,duration};
   const samples=Array.from({length:21},(_,i)=>seatChangePose(change,duration*i/20).position);
   const first=samples[0],last=samples.at(-1);
   expect(first[2]).toBeCloseTo(rising?chair.seat[2]:front[2]);
   expect(last[2]).toBeCloseTo(rising?front[2]:chair.seat[2]);
   expect(samples.every(p=>p.every(Number.isFinite))).toBe(true);
   for(let i=1;i<samples.length;i++)expect(Math.hypot(...samples[i].map((v,j)=>v-samples[i-1][j]))).toBeLessThan(.14);
  }
 });
 it('wires both body styles into the existing transition instead of a snap',()=>{
  const source=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  expect(source).toContain('if(!visitor||!visitorSeat)return false;');
  expect(source).toContain('if(!beginSeatChange(false,front)){visitorSeat=null;');
  expect(source).toContain('if(visitorSeat&&!beginSeatChange(true))');
  expect(source).not.toContain('if(!visitor||!visitorSeat||(!visitor.rig&&!visitorSeat.bed))return false;');
  expect(source).not.toContain('if(visitor?.rig&&!beginSeatChange(false,front))');
  expect(source).toContain("if(seatChange&&['chibi-water','chibi-sit','chibi-stand','chibi-motion','chibi-bed'");
  expect(source).toContain('人物正在坐下或起身，请先完成当前动作');
 });
 it('blocks edits and room changes until the seat transfer has finished',()=>{
  const src=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  const start=src.indexOf('function runAction(d){'),finish=src.indexOf("if(d.action==='control-self')",start);
  const guard=src.slice(start,finish);
  expect(guard).toContain('layoutNavigation');
  expect(guard).toContain('room-layout-apply');
  expect(guard).toContain('room-scope');
  expect(guard).toContain('seatChange||visitorActivity?.bathJourney');
  expect(guard).toContain('请先完成坐下或起身，再修改房间');
 });

});

describe('ordinary seat phase-contact coordination',()=>{
 const change={pose:'chair',front:[.8,.18,1.1],seat:[0,.72,0],rotation:Math.PI,startRotation:-Math.PI+.05,rising:false,duration:seatTransitionDuration('chair',[.8,.18,1.1],[0,.72,0])};
 it('turns on planted feet, bends the knees before sliding into the seat',()=>{
  const turn=seatChangePose(change,.20),load=seatChangePose(change,.49),sit=seatChangePose(change,change.duration);
  expect(turn.position).toEqual(change.front);
  expect(turn.weight).toBe(0);
  expect(load.weight).toBeGreaterThan(load.travel);
  expect(load.position[1]).toBeCloseTo(change.front[1]+(change.seat[1]-change.front[1])*load.weight);
  expect(sit.position).toEqual(change.seat);
  expect(sit.weight).toBe(1);
 });
 for(const fps of [15,30,60]){
  it('remains continuous on '+fps+' fps entering and standing again',()=>{
   for(const rising of [false,true]){
    const job={...change,rising},frames=[];
    for(let t=0;t<job.duration;t+=1/fps)frames.push(seatChangePose(job,t));
    frames.push(seatChangePose(job,job.duration));
    for(let k=1;k<frames.length;k++){
     const a=frames[k-1],b=frames[k];
     expect(Math.hypot(...a.position.map((v,i)=>v-b.position[i]))).toBeLessThan(.22);
     const d=b.rotation-a.rotation;
     expect(Math.abs(Math.atan2(Math.sin(d),Math.cos(d)))).toBeLessThan(.3);
    }
    expect(frames.at(-1).done).toBe(true);
   }
  });
 }
});
