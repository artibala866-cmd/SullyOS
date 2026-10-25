import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {selectedMotions,sampleSelected} from './selectedMotions';
import {socialActions} from './selectedSocial';
import {isIntimacy} from './intimacyMotion';
import {rearHugPhase,rearHugPalmTarget,rearHugContact,planRearHugApproach} from './rearHugMotion';
import {furnitureHandRotation} from './furnitureMotion';
import clip from '../../../public/room3d/motions/selected/home-rear-hug.json';

const segmentDistance=(a:T.Vector3,b:T.Vector3,centre:T.Vector3)=>{
 const d=b.clone().sub(a).setY(0),u=centre.clone().sub(a).setY(0);
 const t=d.lengthSq()>1e-8?T.MathUtils.clamp(u.dot(d)/d.lengthSq(),0,1):0;
 return a.clone().addScaledVector(d,t).setY(0).distanceTo(centre.clone().setY(0));
};
function receiver(yaw:number,scale:number){
 const root=new T.Group();
 root.rotation.y=yaw;root.scale.setScalar(scale);
 const chest=new T.Bone();chest.position.y=1;root.add(chest);
 root.updateWorldMatrix(true,true);
 return {root,rig:{bones:{chest}}} as unknown as ChibiVisitor;
}
describe('rear embrace using the existing scene player',()=>{
 it('registers one paired action in the existing intimacy menu',()=>{
  const entry=selectedMotions.find(v=>v.id==='home-rear-hug');
  expect(entry?.category).toBe('close');
  expect(entry?.participants).toBe(2);
  expect(entry?.duration).toBe(7.5);
  expect(socialActions['home-rear-hug'].duration).toBe(7.5);
  expect(isIntimacy('home-rear-hug')).toBe(true);
  expect(isIntimacy('home-head-pat')).toBe(false);
  expect(clip.version).toBe(1);
  expect(clip.actors).toHaveLength(2);
  for(const a of clip.actors){
   expect(a.times).toEqual([0,7.5]);
   expect(sampleSelected(a as any,4.3).rotations.hips).toEqual(new T.Quaternion());
  }
 });
 it('starts with open arms, responds after the wrap, and completely releases',()=>{
  const high=rearHugPhase(2.7,false);
  const low=rearHugPhase(3.3,true);
  expect(rearHugPhase(0,false).wrap).toBe(0);
  expect(rearHugPhase(.95,false).wrap).toBeGreaterThan(0);
  expect(high.wrap).toBeGreaterThan(.99);
  expect(high.cover).toBeGreaterThan(.8);
  expect(high.second).toBe(0);
  expect(low.second).toBeGreaterThan(0);
  expect(rearHugPhase(5,true).wrap).toBeGreaterThan(.98);
  expect(rearHugPhase(5,true).cover).toBeGreaterThan(.98);
  expect(rearHugPhase(7.5,true).wrap).toBe(0);
  expect(rearHugPhase(7.5,true).cover).toBe(0);
  expect(rearHugPhase(7.25,false).farewell).toBeGreaterThan(.8);
  expect(rearHugPhase(7.5,false).release).toBe(1);
 });
 it('targets separate outer front flank surfaces regardless of height scale and facing',()=>{
  for(const scale of [.45,1,1.7])for(const yaw of [0,.8,-2]){
   const v=receiver(yaw,scale),chest=v.rig!.bones.chest;
   const left=rearHugPalmTarget(v,'L',true);
   const right=rearHugPalmTarget(v,'R',false);
   const a=chest.worldToLocal(left.clone()),b=chest.worldToLocal(right.clone());
   expect(a.x).toBeGreaterThan(.3);
   expect(b.x).toBeLessThan(-.3);
   expect(a.z).toBeGreaterThan(0);
   expect(b.z).toBeGreaterThan(0);
   expect(a.y).toBeLessThan(b.y);
   const ellipse=(p:T.Vector3)=>Math.hypot(p.x/.56,(p.y+.1)/.74,p.z/.4);
   expect(ellipse(a)).toBeGreaterThanOrEqual(1.09-1e-5);
   expect(ellipse(b)).toBeGreaterThanOrEqual(1.09-1e-5);
   expect(left.distanceTo(right)).toBeGreaterThan(.30*scale);
  }
 });
 it('faces the actual PALM into both front-waist and rear-flank surface, not the back of the hand',()=>{
  for(const scale of [.5,1,1.7])for(const yaw of [0,1.2,-1.8]){
   const v=receiver(yaw,scale);
   const chest=v.rig!.bones.chest;
   for(const side of ['L','R'] as const){
    const sign=side==='L'?1:-1;
    const points=[
     rearHugPalmTarget(v,side,side==='L'),
     chest.localToWorld(new T.Vector3(sign*.61,-.25,-.19)),
    ];
    for(const p of points){
     const c=rearHugContact(v,side,p);
     const handQ=furnitureHandRotation(side,c.direction.toArray(),c.normal.toArray());
     const inward=new T.Vector3(0,-1,0).applyQuaternion(handQ);
     expect(inward.dot(c.normal)).toBeLessThan(-.995);
     const outwardWorld=new T.Vector3(sign*.61/(.56*.56),(-.25+.10)/(.74*.74),
      (points.indexOf(p)===0?.23:-.19)/(.40*.40)).normalize().applyQuaternion(chest.getWorldQuaternion(new T.Quaternion()));
     // Side and front/back target normals differ, but both stay outward.
     expect(c.normal.dot(outwardWorld)).toBeGreaterThan(.75);
    }
   }
  }
 });
 it('keeps a distant already-clear house route rather than adding a second scripted walk',()=>{
  const recipient=new T.Vector3(0,0,0),goal=new T.Vector3(0,0,-.57);
  const start=new T.Vector3(0,0,-18);
  let calls=0;
  const find=(a:T.Vector3,b:T.Vector3)=>{calls++;return [a.clone(),b.clone()];};
  const path=planRearHugApproach(start,goal,recipient,new T.Quaternion(),find);
  expect(calls).toBe(1);
  expect(path).toHaveLength(2);
  expect(path?.at(-1)).toEqual(goal);
 });
 it('never sends the giver through a stationary recipient when starting in front',()=>{
  const b=new T.Vector3(0,0,0);
  const goal=new T.Vector3(0,0,-.69);
  const start=new T.Vector3(0,0,1.3);
  const direct=(from:T.Vector3,to:T.Vector3)=>[from.clone(),to.clone()];
  const route=planRearHugApproach(start,goal,b,new T.Quaternion(),direct);
  expect(route).not.toBeNull();
  expect(route!.length).toBeGreaterThan(2);
  for(let i=1;i<route!.length;i++)expect(segmentDistance(route![i-1],route![i],b)).toBeGreaterThanOrEqual(.32-1e-5);
  const behind=new T.Vector3(0,0,-1.2);
  expect(planRearHugApproach(behind,goal,b,new T.Quaternion(),direct)).toHaveLength(2);
 });
 it('rejects a narrow side passage instead of using a through-body shortcut',()=>{
  const b=new T.Vector3(0,0,0),a=new T.Vector3(0,0,1.3),goal=new T.Vector3(0,0,-.69);
  const path=(from:T.Vector3,to:T.Vector3)=>Math.abs(to.x)>.4?null:[from.clone(),to.clone()];
  expect(planRearHugApproach(a,goal,b,new T.Quaternion(),path)).toBeNull();
 });
});
