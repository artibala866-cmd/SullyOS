import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {applyStandingHeightAdaptation,headReachDeficit,standingHeightPlan} from './standingHeightAdaptation';
import {motionTemplateFor,motionTemplatePresets,compileMotionTemplates} from './motionTemplates';

type Fake={visitor:ChibiVisitor;root:T.Group;rig:any;motionBody:T.Group};
function actor(x:number,scale:number):Fake{
 const root=new T.Group();root.position.x=x;
 const motionBody=new T.Group();root.add(motionBody);
 const named:Record<string,T.Bone>={};
 const add=(name:string,parent:T.Object3D,xyz:readonly [number,number,number])=>{
  const bone=new T.Bone();bone.position.set(...xyz);parent.add(bone);named[name]=bone;return bone;
 };
 const hips=add('hips',motionBody,[0,1,0]);
 const spine=add('spine',hips,[0,.24,0]);
 const chest=add('chest',spine,[0,.24,0]);
 const neck=add('neck',chest,[0,.17,0]);
 add('head',neck,[0,.15,0]);
 for(const side of ['L','R'] as const){
  const sign=side==='L'?1:-1;
  const thigh=add(side+'_thigh',hips,[sign*.12,-.30,0]);
  const shin=add(side+'_shin',thigh,[0,-.35,0]);
  const foot=add(side+'_foot',shin,[0,-.35,0]);
  add(side+'_toe',foot,[0,-.015,.085]);
  const upper=add(side+'_upperArm',chest,[sign*.18,.02,0]);
  const lower=add(side+'_forearm',upper,[sign*.29,0,0]);
  add(side+'_hand',lower,[sign*.27,0,0]);
 }
 motionBody.scale.setScalar(scale);
 root.updateWorldMatrix(true,true);
 const rig={bones:named,mesh:motionBody,bodyHeight:scale};
 const visitor={
  root,rig,
  getHeadTopWorldPosition:()=>{
   root.updateWorldMatrix(true,true);
   return named.head.localToWorld(new T.Vector3(0,.27,0));
  },
  translatePose:(delta:T.Vector3)=>{motionBody.position.add(delta);root.updateWorldMatrix(true,true);},
 } as unknown as ChibiVisitor;
 return {visitor,root,rig,motionBody};
}
function sole(f:Fake){
 f.root.updateWorldMatrix(true,true);
 return Math.min(...['L_toe','R_toe','L_foot','R_foot'].map(n=>f.rig.bones[n].getWorldPosition(new T.Vector3()).y));
}
describe('symmetric standing interaction height adaptation',()=>{
 it('uses actual world heights, never User/Char or initiator/recipient labels',()=>{
  const a=standingHeightPlan([2.7,1.6],'headReach',.4);
  const b=standingHeightPlan([1.6,2.7],'headReach',.4);
  expect(a.tallIndex).toBe(0);
  expect(b.tallIndex).toBe(1);
  expect(a.crouch).toBe(b.crouch);
  expect(a.bow).toBe(b.bow);
  expect(a.shortLook).toBeGreaterThan(0);
  expect(a.tallLook).toBeGreaterThan(0);
 });
 it('works on either side and lowers the physically taller head while feet remain planted',()=>{
  for(const invert of [false,true]){
   const high=actor(.34,1.5),low=actor(-.34,.75);
   const both=(invert?[high.visitor,low.visitor]:[low.visitor,high.visitor]) as [ChibiVisitor,ChibiVisitor];
   const before=high.visitor.getHeadTopWorldPosition().y;
   const footBefore=sole(high);
   const hiRoot=high.root.position.clone(),loRoot=low.root.position.clone();
   const plan=applyStandingHeightAdaptation(both,{mode:'headReach',actorIndex:invert?1:0,weight:1});
   expect(plan?.tallIndex).toBe(invert?0:1);
   expect(high.visitor.getHeadTopWorldPosition().y).toBeLessThan(before-.08);
   expect(Math.abs(sole(high)-footBefore)).toBeLessThan(.012);
   expect(high.root.position).toEqual(hiRoot);
   expect(low.root.position).toEqual(loRoot);
   expect(high.rig.bones.neck.rotation.x).toBeGreaterThan(0);
   expect(low.rig.bones.neck.rotation.x).toBeLessThan(0);
   expect(high.rig.bones.L_shin.rotation.x).toBeGreaterThan(.01);
   expect(high.rig.bones.R_shin.rotation.x).toBeGreaterThan(.01);
  }
 });
 it('lets the high receiver lower to the short initiator, or the high initiator bend toward the short receiver',()=>{
  const short=actor(-.34,.7),tall=actor(.34,1.45);
  const down=headReachDeficit([short.visitor,tall.visitor],0);
  expect(down).toBeGreaterThan(0);
  const plan=standingHeightPlan([
   short.visitor.getHeadTopWorldPosition().y,
   tall.visitor.getHeadTopWorldPosition().y,
  ],'headReach',down);
  const startDeficit=down;
  applyStandingHeightAdaptation([short.visitor,tall.visitor],{mode:'headReach',actorIndex:0,weight:1});
  const adjustedDeficit=headReachDeficit([short.visitor,tall.visitor],0);
  // The point is reachable movement, not a cosmetic bow that leaves the
  // contact goal as far outside the short partner's arm reach as before.
  expect(adjustedDeficit).toBeLessThan(startDeficit-.05);
  expect(plan.neededDrop).toBeGreaterThan(.2);
  expect(plan.tallIndex).toBe(1);
  const reversed=standingHeightPlan([2.9,1.4],'headReach',.2);
  expect(reversed.tallIndex).toBe(0);
  expect(reversed.crouch).toBeGreaterThan(0);
 });
 it('never changes equal-height or disabled motions',()=>{
  const a=actor(-.4,1),b=actor(.4,1);
  const aBefore=a.visitor.getHeadTopWorldPosition().clone();
  const p=applyStandingHeightAdaptation([a.visitor,b.visitor],{mode:'contact',weight:1});
  expect(p?.gap).toBe(0);
  expect(a.visitor.getHeadTopWorldPosition()).toEqual(aBefore);
  expect(applyStandingHeightAdaptation([a.visitor,b.visitor],{mode:'none',weight:1})).toBeNull();
  expect(a.rig.bones.L_shin.rotation.x).toBe(0);
 });
 it('always gives future standing contact templates shared height adaptation, leaves specialized legacy solvers alone',()=>{
  expect(motionTemplatePresets.pairedHands({pairing:'sampledClosest',enter:[1,2],curl:.2}).standingHeight).toBe('contact');
  expect(motionTemplatePresets.bodyTouch({targetBones:['L_upperArm','R_upperArm'],near:.3,far:.5}).standingHeight).toBe('contact');
  expect(motionTemplatePresets.faceContact('noseTouch').standingHeight).toBe('gaze');
  expect(motionTemplateFor('home-head-pat')?.standingHeight).toBe('headReach');
  expect(motionTemplateFor('home-hug')).toBeUndefined();
  expect(motionTemplateFor('home-kiss')).toBeUndefined();
  expect(()=>compileMotionTemplates([{id:'solo',participants:1}],{
   solo:{participants:1,capabilities:['singlePose'],standingHeight:'contact',posture:'standing'}
  })).toThrow(/height/);
 });
});
