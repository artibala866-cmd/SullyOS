import {describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {motionTemplateFor} from './motionTemplates';
import {headPatTimeline,applyHeadPatMotion,applyHeadPatExpressions,HEAD_PAT_TIMING} from './headPatMotion';
import {sampleSelected} from './selectedMotions';
import clip from '../../../public/room3d/motions/selected/home-head-pat.json';

const recipe=motionTemplateFor('home-head-pat')!.headTouch!;
function resident(x:number){
 const root=new T.Group();root.position.x=x;
 const classicContact=vi.fn();
 const setActionExpression=vi.fn();
 const visitor={root,rig:null,getHeadTopWorldPosition:()=>new T.Vector3(x,1.8,0),
  classicContact,setActionExpression} as unknown as ChibiVisitor;
 return {visitor,solver:null,classicContact,setActionExpression};
}
describe('head pet and playful hair ruffle',()=>{
 it('has one tiny valid lazy clip and two shared stationary tracks',()=>{
  expect(clip.id).toBe('home-head-pat');
  expect(clip.actors).toHaveLength(2);
  expect(clip.duration).toBe(7.8);
  for(const actor of clip.actors){
   expect(actor.times).toEqual([0,7.8]);
   expect(sampleSelected(actor as any,3).rotations.hips).toEqual(new T.Quaternion());
  }
 });
 it('performs exactly two isolated pats before the two-handed ruffle',()=>{
  const half=HEAD_PAT_TIMING.patStart;
  const pulsePeaks=Array.from({length:400},(_,i)=>half+i*(HEAD_PAT_TIMING.patEnd-half)/399)
   .filter(t=>headPatTimeline(t,recipe).patPulse>.98);
  const groups:number[][]=[];
  for(const time of pulsePeaks){
   if(!groups.length||time-groups.at(-1)!.at(-1)!>.03)groups.push([time]);
   else groups.at(-1)!.push(time);
  }
  expect(groups).toHaveLength(2);
  expect(headPatTimeline(.2,recipe).single).toBe(0);
  expect(headPatTimeline(2,recipe).double).toBe(0);
  expect(headPatTimeline(4,recipe).double).toBeGreaterThan(.9);
  expect(headPatTimeline(7.5,recipe).single).toBe(0);
  const xs=Array.from({length:301},(_,i)=>headPatTimeline(3.7+i*(6.28-3.7)/300,recipe).rubX);
  // Count two positive crests, not zero crossings at the final endpoint.
  const crests=xs.filter((v,i)=>i>0&&i<xs.length-1&&v>xs[i-1]&&v>=xs[i+1]&&v>.2);
  expect(crests).toHaveLength(2);
 });
 it('uses existing contact method for old classic bodies and does not translate roots',()=>{
  const a=resident(-.5),b=resident(.5),p=a.visitor.root.position.clone();
  expect(applyHeadPatMotion(recipe,[a,b],2.0,1)).toBe(true);
  expect(a.classicContact).toHaveBeenCalledTimes(1);
  expect(a.classicContact.mock.calls[0][0]).toBe('R');
  expect(a.visitor.root.position).toEqual(p);
  a.classicContact.mockClear();
  applyHeadPatMotion(recipe,[a,b],4.6,1);
  expect(a.classicContact).toHaveBeenCalledTimes(2);
  expect(a.classicContact.mock.calls.map(c=>c[0]).sort()).toEqual(['L','R']);
 });

 it('tracks a moving crown using both existing arm IK goals without shifting either root',()=>{
  const giver=resident(-.5),receiver=resident(.5),solve=vi.fn();
  const p=giver.visitor.root.position.clone(),q=receiver.visitor.root.position.clone();
  const crown={height:1.9};
  const neck=new T.Bone(),head=new T.Bone(),chest=new T.Bone(),mesh=new T.Group();
  receiver.visitor.root.add(chest);chest.add(neck);neck.add(head);receiver.visitor.root.add(mesh);
  (giver.visitor as any).rig={};
  (giver as any).solver=solve;
  (receiver.visitor as any).rig={bones:{head,neck,chest},mesh};
  (receiver.visitor as any).getHeadTopWorldPosition=()=>new T.Vector3(.5,crown.height,0);
  applyHeadPatMotion(recipe,[giver,receiver],4.6,1);
  expect(solve).toHaveBeenCalledTimes(2);
  const before=solve.mock.calls[0][0].point.y;
  crown.height+=.19;solve.mockClear();
  applyHeadPatMotion(recipe,[giver,receiver],4.6,1);
  expect(solve.mock.calls[0][0].point.y).toBeGreaterThan(before+.12);
  expect(giver.visitor.root.position).toEqual(p);
  expect(receiver.visitor.root.position).toEqual(q);
 });
 it('keeps receiver smiling before the rub and surprised only during ruffling',()=>{
  const a=resident(0),b=resident(1);
  applyHeadPatExpressions(recipe,[a,b],2);
  expect(b.setActionExpression).toHaveBeenLastCalledWith('smiling',2);
  applyHeadPatExpressions(recipe,[a,b],5);
  expect(b.setActionExpression).toHaveBeenLastCalledWith('surprised',5);
  applyHeadPatExpressions(recipe,[a,b],7.8);
  expect(b.setActionExpression).toHaveBeenLastCalledWith('smiling',7.8);
  expect(a.setActionExpression).toHaveBeenLastCalledWith('smiling',7.8);
 });
});
