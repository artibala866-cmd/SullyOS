import {describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {motionTemplateFor} from './motionTemplates';
import {headPatTimeline,headPatHandGoal,headPatScalpSize,applyHeadPatMotion,applyHeadPatExpressions,HEAD_PAT_TIMING} from './headPatMotion';
import {furnitureHandRotation} from './furnitureMotion';
import {contactSolver} from './socialContact';
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
 it('keeps left/right palms uncrossed, facing DOWN even when role and height reverse',()=>{
  for(const actorSide of [-1,1]){
   for(const [actorHeight,receiverHeight] of [[1.4,2.9],[2.9,1.4],[2,2]]){
    const actor=resident(actorSide*.45),receiver=resident(-actorSide*.45);
    (actor.visitor as any).getHeadTopWorldPosition=()=>new T.Vector3(actorSide*.45,actorHeight,0);
    (receiver.visitor as any).getHeadTopWorldPosition=()=>new T.Vector3(-actorSide*.45,receiverHeight,0);
    const p=headPatTimeline(4.65,recipe);
    const crown=receiver.visitor.getHeadTopWorldPosition();
    const left=headPatHandGoal(actor.visitor,receiver.visitor,'L',crown,new T.Vector3(0,1,0),.14,p,true);
    const right=headPatHandGoal(actor.visitor,receiver.visitor,'R',crown,new T.Vector3(0,1,0),.14,p,true);
    const forward=crown.clone().sub(actor.visitor.root.position).setY(0).normalize();
    const lateral=new T.Vector3().crossVectors(new T.Vector3(0,1,0),forward);
    expect(left.scalpPoint.clone().sub(crown).dot(lateral)).toBeGreaterThan(.11);
    expect(right.scalpPoint.clone().sub(crown).dot(lateral)).toBeLessThan(-.11);
    expect(left.scalpPoint.distanceTo(right.scalpPoint)).toBeGreaterThan(.22);
    for(const hand of [left,right]){
     // Side-of-head, not the old almost-center crown target.
     expect(hand.scalpPoint.y).toBeLessThan(crown.y+.04); // the small-radius mock permits a slight hover
     const q=furnitureHandRotation(hand.side,hand.direction.toArray(),hand.normal.toArray());
     const palmFacingHair=new T.Vector3(0,-1,0).applyQuaternion(q);
     expect(palmFacingHair.dot(hand.normal)).toBeLessThan(-.98);
     expect(palmFacingHair.y).toBeLessThan(-.48);
     expect(Number.isFinite(hand.point.x+hand.point.y+hand.point.z)).toBe(true);
    }
   }
  }
 });
 it('measures true chibi head breadth and keeps full both-hand ruffles on opposite side panels',()=>{
  for(const actorX of [-.4,.4])for(const [giverHeight,receiverHeight] of [[1.15,2.6],[2.6,1.15],[1.9,1.9]]){
   const giver=resident(actorX),recipient=resident(-actorX);
   const rigHead=new T.Bone(),mesh=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());
   rigHead.position.y=receiverHeight-.4;
   recipient.visitor.root.add(rigHead,mesh);
   mesh.geometry.userData.headSize=1.1;
   rigHead.scale.setScalar(.7);
   (recipient.visitor as any).rig={bones:{head:rigHead},mesh};
   (recipient.visitor as any).getHeadTopWorldPosition=()=>new T.Vector3(-actorX,receiverHeight,0);
   const size=headPatScalpSize(recipient.visitor);
   expect(size.radius).toBeGreaterThan(.35);
   const crown=recipient.visitor.getHeadTopWorldPosition();
   const lateral=new T.Vector3().crossVectors(
    new T.Vector3(0,1,0),crown.clone().sub(giver.visitor.root.position).setY(0).normalize());
   const frames=[3.75,4.05,4.6,5.0,5.4,5.8,6.1];
   for(const t of frames){
    const phase=headPatTimeline(t,recipe);
    const left=headPatHandGoal(giver.visitor,recipient.visitor,'L',
     crown,new T.Vector3(0,1,0),size.radius,phase,true);
    const right=headPatHandGoal(giver.visitor,recipient.visitor,'R',
     crown,new T.Vector3(0,1,0),size.radius,phase,true);
    expect(left.scalpPoint.clone().sub(crown).dot(lateral)).toBeGreaterThan(size.radius*.68);
    expect(right.scalpPoint.clone().sub(crown).dot(lateral)).toBeLessThan(-size.radius*.68);
    expect(left.scalpPoint.distanceTo(right.scalpPoint)).toBeGreaterThan(size.radius*1.35);
    expect(left.scalpPoint.y).toBeLessThan(crown.y);
    expect(right.scalpPoint.y).toBeLessThan(crown.y);
    expect(left.normal.dot(new T.Vector3(0,1,0))).toBeGreaterThan(.45);
    expect(right.normal.dot(new T.Vector3(0,1,0))).toBeGreaterThan(.45);
   }
  }
 });
 it('uses actual anatomical shoulders when head is turned and the actor faces from either side',()=>{
  for(const yaw of [-Math.PI/2,Math.PI/2]){
   const giver=resident(-.3),receiver=resident(.3),crown=new T.Vector3(.3,1.7,0);
   giver.visitor.root.rotation.y=yaw;
   const L=new T.Bone(),R=new T.Bone();
   L.position.set(.24,1.05,0);R.position.set(-.24,1.05,0);
   giver.visitor.root.add(L,R);
   (giver.visitor as any).rig={bones:{L_upperArm:L,R_upperArm:R}};
   const phase=headPatTimeline(5,recipe);
   const left=headPatHandGoal(giver.visitor,receiver.visitor,'L',crown,
    new T.Vector3(.17,.95,0),.42,phase,true);
   const right=headPatHandGoal(giver.visitor,receiver.visitor,'R',crown,
    new T.Vector3(.17,.95,0),.42,phase,true);
   const actualLeft=L.getWorldPosition(new T.Vector3()).sub(R.getWorldPosition(new T.Vector3())).normalize();
   expect(left.scalpPoint.clone().sub(crown).dot(actualLeft)).toBeGreaterThan(.24);
   expect(right.scalpPoint.clone().sub(crown).dot(actualLeft)).toBeLessThan(-.24);
  }
 });
 it('keeps the actual CCD-solved wrists on their own sides of the scalp',()=>{
  for(const facing of [0,Math.PI]){
   const giver=resident(0),receiver=resident(0),root=giver.visitor.root;
   root.position.set(0,0,facing===0?-.35:.35);
   root.rotation.y=facing;
   receiver.visitor.root.position.set(0,0,facing===0?.35:-.35);
   const base=new T.Bone();root.add(base);
   const bones:Record<string,T.Bone>={};
   const rigBones=[base];
   for(const side of ['L','R'] as const){
    const sign=side==='L'?1:-1;
    const upper=new T.Bone(),lower=new T.Bone(),hand=new T.Bone();
    upper.position.set(sign*.23,1.22,0);base.add(upper);
    lower.position.set(sign*.5,0,0);upper.add(lower);
    hand.position.set(sign*.49,0,0);lower.add(hand);
    bones[side+'_upperArm']=upper;
    bones[side+'_forearm']=lower;
    bones[side+'_hand']=hand;
    rigBones.push(upper,lower,hand);
   }
   (giver.visitor as any).rig={bones,skeleton:new T.Skeleton(rigBones),setHandCurl:()=>{}};
   const head=new T.Bone(),mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());
   head.position.y=1.40;head.scale.setScalar(.72);
   receiver.visitor.root.add(head,mesh);
   mesh.geometry.userData.headSize=1;
   (receiver.visitor as any).rig={bones:{head},mesh};
   (receiver.visitor as any).getHeadTopWorldPosition=()=>
    receiver.visitor.root.localToWorld(new T.Vector3(0,1.76,0));
   const scalp=receiver.visitor.getHeadTopWorldPosition();
   const lateral=bones.L_upperArm.getWorldPosition(new T.Vector3())
    .sub(bones.R_upperArm.getWorldPosition(new T.Vector3())).normalize();
   const worker=contactSolver(giver.visitor);
   expect(worker).not.toBeNull();
   applyHeadPatMotion(recipe,[{visitor:giver.visitor,solver:worker},{visitor:receiver.visitor,solver:null}],4.5,1);
   const lHand=bones.L_hand.getWorldPosition(new T.Vector3()),rHand=bones.R_hand.getWorldPosition(new T.Vector3());
   expect(lHand.clone().sub(scalp).dot(lateral)).toBeGreaterThan(.05);
   expect(rHand.clone().sub(scalp).dot(lateral)).toBeLessThan(-.05);
   expect(lHand.distanceTo(rHand)).toBeGreaterThan(.20);
  }
 });
 it('limits unreachable wrist goals without pulling forearms through the other head',()=>{
  for(const [giverHeight,targetHeight] of [[1.1,3.1],[3.1,1.1]]){
   const giver=resident(-.5),receiver=resident(.5);
   const upper=new T.Bone(),forearm=new T.Bone(),hand=new T.Bone();
   giver.visitor.root.add(upper);
   upper.position.set(0,giverHeight-.50,0);
   upper.add(forearm);forearm.position.set(.22,0,0);
   forearm.add(hand);hand.position.set(.22,0,0);
   (giver.visitor as any).rig={bones:{R_upperArm:upper,R_forearm:forearm,R_hand:hand}};
   (receiver.visitor as any).getHeadTopWorldPosition=()=>new T.Vector3(.5,targetHeight,0);
   const crown=receiver.visitor.getHeadTopWorldPosition();
   const p=headPatTimeline(2,recipe);
   const goal=headPatHandGoal(giver.visitor,receiver.visitor,'R',crown,new T.Vector3(0,1,0),.12,p,false);
   const shoulder=upper.getWorldPosition(new T.Vector3());
   const maxReach=upper.getWorldPosition(new T.Vector3()).distanceTo(forearm.getWorldPosition(new T.Vector3()))+
     forearm.getWorldPosition(new T.Vector3()).distanceTo(hand.getWorldPosition(new T.Vector3()));
   expect(goal.deficit).toBeGreaterThan(.1);
   expect(shoulder.distanceTo(goal.point)).toBeLessThanOrEqual(maxReach*.95+1e-6);
   expect(goal.point.distanceTo(crown)).toBeGreaterThan(.08);
  }
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
