import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import type {MotionTrack,SelectedClip} from './selectedMotions';
import type {Contact,contactSolver} from './socialContact';
import {sampledHandPair,applyPairedHandContact} from './pairedHandContact';
import {motionContactProfile} from './motionContactProfiles';

const repeat=(p:readonly [number,number,number])=>[...p,...p];
function track(left:readonly [number,number,number],right:readonly [number,number,number]):MotionTrack{
 return {
  duration:10,
  times:[0,10],
  tracks:{},
  positions:[0,0,0,0,0,0],
  points:{L_hand:repeat(left),R_hand:repeat(right)},
  hipHeight:0,
 };
}
function clip():SelectedClip{
 return {version:1,id:'cmu-20_10',duration:10,actors:[
  track([8,0,0],[0,0,0]),
  track([.1,0,0],[20,0,0]),
 ]};
}
function actor(){
 const root=new T.Group(),left=new T.Bone(),right=new T.Bone();
 left.position.set(.4,0,0);right.position.set(-.4,0,0);
 root.add(left,right);
 root.updateWorldMatrix(true,true);
 const calls:{contact:Contact;weight:number}[]=[];
 const solver=((contact:Contact,weight:number)=>{calls.push({contact,weight});}) as ReturnType<typeof contactSolver>;
 const visitor={root,rig:{bones:{L_hand:left,R_hand:right}}} as unknown as ChibiVisitor;
 return {resident:{visitor,solver},calls};
}
describe('reusable paired palm contact runtime',()=>{
 it('chooses a fixed pair by sampled capture frames, then caches it',()=>{
  const source=clip();
  expect(sampledHandPair(source)).toEqual(['R','L']);
  source.actors[0].points.R_hand=repeat([200,0,0]);
  expect(sampledHandPair(source)).toEqual(['R','L']);
 });
 it('samples a shared palm target before either solve and keeps source curl',()=>{
  const profile=motionContactProfile('cmu-20_10');
  if(profile?.kind!=='pairedHands')throw Error('Missing twirl profile');
  const a=actor(),b=actor();
  const handled=applyPairedHandContact(profile,clip(),[a.resident,b.resident],.8,.85);
  expect(handled).toBe(true);
  expect(a.calls).toHaveLength(1);
  expect(b.calls).toHaveLength(1);
  expect(a.calls[0].contact.side).toBe('R');
  expect(b.calls[0].contact.side).toBe('L');
  expect(a.calls[0].contact.point.distanceTo(b.calls[0].contact.point)).toBe(0);
  expect(a.calls[0].contact.curl).toBe(.38);
  expect(b.calls[0].weight).toBeCloseTo(.8);
 });
 it('does not run IK after the low-five contact window',()=>{
  const profile=motionContactProfile('cmu-20_12');
  if(profile?.kind!=='pairedHands')throw Error('Missing low-five profile');
  const a=actor(),b=actor();
  expect(applyPairedHandContact(profile,clip(),[a.resident,b.resident],1,1.5)).toBe(true);
  expect(a.calls).toHaveLength(0);
  expect(b.calls).toHaveLength(0);
 });
 it('falls back for classic bodies without a rig',()=>{
  const profile=motionContactProfile('cmu-20_10');
  if(profile?.kind!=='pairedHands')throw Error('Missing twirl profile');
  const a=actor(),b=actor();
  b.resident.visitor.rig=null as unknown as ChibiVisitor['rig'];
  expect(applyPairedHandContact(profile,clip(),[a.resident,b.resident],1,1)).toBe(false);
  expect(a.calls).toHaveLength(0);
 });
});
