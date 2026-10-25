import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {furnitureHandRotation} from './furnitureMotion';
import {selectedMotions,sampleSelected} from './selectedMotions';
import {socialActions,createSocialScene} from './selectedSocial';
import {isIntimacy} from './intimacyMotion';
import {sofaLapPillowSeatPair} from '../sofaLapPillowSeats';
import {lapPillowSide,lapPillowHeadTarget,lapPillowHeadContact,sofaLapPillowPhase,poseSofaLapPillow} from './sofaLapPillowMotion';
import clip from '../../../public/room3d/motions/selected/home-sofa-lap-pillow.json';
import catalog from '../../../public/room3d/catalog.json';

const room:any={id:'living',items:[{id:'couch',assetId:'show_living_sofa',x:1,y:0,z:2,rotation:45,stored:false},
 {id:'chair',assetId:'dining_chair',x:0,y:0,z:0,rotation:0,stored:false}]};
const seat=(itemId:string,seatId:string)=>({roomId:'living',itemId,seatId});
describe('sofa-only 9.3-second intimate lap pillow',()=>{
 it('is in the original close menu with two shared-clock seated actors',()=>{
  const entry=selectedMotions.find(e=>e.id==='home-sofa-lap-pillow');
  expect(entry?.label).toBe('沙发膝枕');
  expect(entry?.category).toBe('close');
  expect(entry?.participants).toBe(2);
  expect(entry?.duration).toBe(9.3);
  expect(socialActions['home-sofa-lap-pillow'].duration).toBe(9.3);
  expect(isIntimacy('home-sofa-lap-pillow')).toBe(true);
  expect(clip.version).toBe(1);
  expect(clip.id).toBe(entry?.id);
  expect(clip.actors).toHaveLength(2);
  for(const actor of clip.actors){
   expect(actor.times).toEqual([0,9.3]);
   expect(sampleSelected(actor,5).rotations.hips).toEqual(new T.Quaternion());
  }
 });
 it('requires two distinct seats on ONE sofa, rather than same chair or empty floor',()=>{
  const pair=sofaLapPillowSeatPair(room,catalog as any[],seat('couch','0'),seat('couch','1'));
  expect(pair).not.toBeNull();
  expect(pair!.distance).toBeGreaterThan(1.8);
  expect(pair!.distance).toBeLessThan(2.1);
  expect(sofaLapPillowSeatPair(room,catalog as any[],seat('couch','0'),seat('couch','0'))).toBeNull();
  expect(sofaLapPillowSeatPair(room,catalog as any[],seat('chair','0'),seat('chair','1'))).toBeNull();
  expect(sofaLapPillowSeatPair(room,catalog as any[],seat('couch','0'),seat('chair','0'))).toBeNull();
  expect(sofaLapPillowSeatPair(room,catalog as any[],seat('couch','0'),undefined)).toBeNull();
 });
 it('also gives the stock soft two-person sofa real seat metadata',()=>{
  const item=(catalog as any[]).find(x=>x.id==='sofa');
  expect(item.seats.map((x:any)=>x.id)).toEqual(['left','right']);
  const state={id:'living',items:[{id:'small',assetId:'sofa',x:0,y:0,z:0,rotation:0,stored:false}]};
  expect(sofaLapPillowSeatPair(state,catalog as any[],seat('small','left'),seat('small','right'))?.distance).toBeCloseTo(1.2);
 });
 it('lowers slowly, holds the head on the thigh for two distinct long strokes, then rises without popping',()=>{
  expect(sofaLapPillowPhase(0).lower).toBe(0);
  expect(sofaLapPillowPhase(1.2).brace).toBeGreaterThan(0);
  expect(sofaLapPillowPhase(2.85).lower).toBe(1);
  expect(sofaLapPillowPhase(3.7).support).toBe(0);
  expect(sofaLapPillowPhase(4.22).first).toBe(1);
  expect(sofaLapPillowPhase(4.22).second).toBe(0);
  expect(sofaLapPillowPhase(6.18).first).toBe(0);
  expect(sofaLapPillowPhase(6.18).second).toBe(1);
  expect(sofaLapPillowPhase(7.25).lower).toBeGreaterThan(.90);
  expect(sofaLapPillowPhase(7.25).brace).toBeGreaterThan(0);
  expect(sofaLapPillowPhase(9.3).lower).toBe(0);
  expect(sofaLapPillowPhase(9.3).stroke).toBe(0);
  expect(sofaLapPillowPhase(9.3).brace).toBe(0);
 });
 function fakeVisitor(x:number,scale=1):ChibiVisitor{
  const root=new T.Group();root.position.set(x,.18,0);root.scale.setScalar(scale);
  const bones:Record<string,T.Bone>={};
  const add=(name:string,parent:T.Object3D,pos:[number,number,number])=>{
   const bone=new T.Bone();bone.position.set(...pos);parent.add(bone);bones[name]=bone;return bone;
  };
  const hips=add('hips',root,[0,.8,0]);
  const spine=add('spine',hips,[0,.25,0]),chest=add('chest',spine,[0,.22,0]);
  add('head',chest,[0,.35,0]);
  for(const side of ['L','R'] as const){
   const sign=side==='L'?1:-1;
   add(side+'_thigh',hips,[sign*.20,-.20,.24]);
   add(side+'_shin',bones[side+'_thigh'],[0,-.12,.33]);
   add(side+'_hand',chest,[sign*.36,0,.10]);
  }
  root.updateWorldMatrix(true,true);
  return {
   root,rig:{bones,setHandCurl:()=>{}},
   getHeadWorldPosition:()=>bones.head.localToWorld(new T.Vector3(0,.72,0)),
   translatePose:(offset:T.Vector3)=>{hips.position.add(offset);root.updateWorldMatrix(true,true);},
  } as any;
 }
 it('orients head/leg support for either side and across height differences',()=>{
  for(const [left,right] of [[-1,1],[1,-1],[-.7,.7]]){
   const a=fakeVisitor(left,.8),b=fakeVisitor(right,1.2);
   const sign=lapPillowSide(a,b);
   expect(sign).toBe(right>left?1:-1);
   const goal=lapPillowHeadTarget(a,b);
   expect(goal.x).toBeGreaterThan(Math.min(left,right)-.5);
   expect(goal.x).toBeLessThan(Math.max(left,right)+.5);
   expect(Number.isFinite(goal.y)).toBe(true);
   const occiput=lapPillowHeadContact(b,a,'L',0,1);
   const headQ=a.rig!.bones.head.getWorldQuaternion(new T.Quaternion());
   const back=new T.Vector3(0,0,-1).applyQuaternion(headQ);
   expect(occiput.normal.dot(back)).toBeGreaterThan(.85);
   const handRotation=furnitureHandRotation('L',occiput.direction.toArray(),occiput.normal.toArray());
   expect(new T.Vector3(0,-1,0).applyQuaternion(handRotation).dot(occiput.normal)).toBeLessThan(-.999);
   const contact=lapPillowHeadContact(b,a,'L',.5);
   const rotation=furnitureHandRotation('L',contact.direction.toArray(),contact.normal.toArray());
   // Hand bone local +Y is the BACK, so local -Y faces INTO the scalp.
   expect(new T.Vector3(0,-1,0).applyQuaternion(rotation).dot(contact.normal)).toBeLessThan(-.999);
  }
 });
 it('keeps both sofa roots still and actually moves the lying head while the giver reaches the hair',()=>{
  const a=fakeVisitor(-.60),b=fakeVisitor(.60);
  const recorded:any[]=[];
  const both=[{visitor:a,solver:(c:any,w:number)=>recorded.push({from:'A',c,w})},
   {visitor:b,solver:(c:any,w:number)=>recorded.push({from:'B',c,w})}] as const;
  const roots=[a.root.position.clone(),b.root.position.clone()];
  expect(poseSofaLapPillow(both,4.22)).toBe(true);
  expect(a.root.position).toEqual(roots[0]);
  expect(b.root.position).toEqual(roots[1]);
  expect(recorded.some(x=>x.from==='B'&&x.w>.4)).toBe(true);
  expect(recorded.some(x=>x.from==='B'&&x.c.normal.length()>.99)).toBe(true);
  expect(a.rig!.bones.hips.quaternion.angleTo(new T.Quaternion())).toBeGreaterThan(.6);
 });
});
