import {describe,expect,it,vi} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
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
 });

// Real production skeleton, seated pose and CCD palm solver. These numerical
// checks do not replace visual review of skin, clothing, hair or sofa meshes.
import {createBlankBody,BLANK_SCALE} from './blankBody';
import {bindBlankBody} from './blankRig';
import {createBlankMotion} from './blankMotion';
import {contactSolver} from './socialContact';
import {furniturePalm} from './furnitureMotion';

function resident(x:number,height:number,yaw:number,headSize=1){
 const root=new T.Group(),scaled=new T.Group(),body=new T.Group();
 root.position.set(0,.65,0);root.rotation.y=yaw;
 root.position.add(new T.Vector3(x,0,0).applyQuaternion(root.quaternion));
 root.add(scaled);scaled.scale.setScalar(2.8/BLANK_SCALE);scaled.add(body);
 const mesh=new T.Mesh(createBlankBody('skin',{bodyHeight:height,headSize}),new T.MeshBasicMaterial());
 body.add(mesh);const rig=bindBlankBody(mesh,new T.Group(),true);
 const animate=createBlankMotion(rig,body);
 const visitor={root,rig,seatOffset:0,
  getHeadWorldPosition:()=>rig.bones.head.localToWorld(new T.Vector3(0,.72,0)),
  translatePose:(delta:T.Vector3)=>{const parent=body.parent!;parent.updateWorldMatrix(true,false);
   body.position.add(parent.worldToLocal(delta.clone()).sub(parent.worldToLocal(new T.Vector3())));
   root.updateWorldMatrix(true,true);},
 } as ChibiVisitor;
 const reset=()=>{animate(0,'idle','seated',{kind:'social',hands:[],seatHeight:.65});root.updateWorldMatrix(true,true);};
 reset();return {visitor,solver:contactSolver(visitor),reset,body};
}

describe('lap pillow with the production seated skeleton and palm IK',()=>{
 it('finishes the scoot and plants support before reclining, then rises before returning hips',()=>{
  expect(sofaLapPillowPhase(1.4).scoot).toBe(1);
  expect(sofaLapPillowPhase(1.4).brace).toBe(1);
  expect(sofaLapPillowPhase(1.4).lower).toBe(0);
  expect(sofaLapPillowPhase(7.1).brace).toBe(1);
  expect(sofaLapPillowPhase(7.1).lower).toBe(1);
  expect(sofaLapPillowPhase(8.3).scoot).toBe(1);
  for(const key of ['brace','lower','scoot','turn','settle','stroke'] as const)
   expect(sofaLapPillowPhase(9.3)[key]).toBe(0);
 });
 for(const [distance,ah,bh,yaw,sign,headSize] of [
  [1.2,1,1,0,1,1],[1.88,.8,1.2,Math.PI/2,1,1],[2.05,1.2,.8,-.7,-1,1],
  [1.2,1,1,Math.PI,-1,1.2],[1.88,1.2,.8,.9,-1,1.2],[2.05,.8,1.2,-1.3,1,.85],
 ])it(`maintains contact and continuous motion: ${[distance,ah,bh,yaw,sign]}`,()=>{
  const a=resident(-sign*distance/2,ah,yaw,headSize),b=resident(sign*distance/2,bh,yaw);
  const startHip=a.visitor.rig!.bones.hips.getWorldPosition(new T.Vector3());
  const startHead=a.visitor.getHeadWorldPosition();
  const starts=[a.visitor.root.position.clone(),b.visitor.root.position.clone()];
  let previous:T.Vector3[]|undefined,maxHeadStep=0,maxHandStep=0,minPalm=Infinity,maxGap=0,maxHipY=0,worstHandTime=0,minPalmTime=0,maxBError=0,maxHandAngle=0;
  let previousRotations:T.Quaternion[]|undefined;
  const bonePositions=Object.values(a.visitor.rig!.bones).map(b=>b.position.clone());
  for(let frame=0;frame<=279;frame++){
   const time=frame/30;a.reset();b.reset();poseSofaLapPillow([a,b],time);
   const head=a.visitor.getHeadWorldPosition();
   const hands=['L','R'].map(side=>a.visitor.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side)));
   const sideB=lapPillowSide(b.visitor,a.visitor)>0?'L':'R';
   const bp=b.visitor.rig!.bones[sideB+'_hand'].localToWorld(furniturePalm(sideB));
   if(time>=3.85&&time<=6.35){const p=sofaLapPillowPhase(time);
    const target=lapPillowHeadContact(b.visitor,a.visitor,sideB,p.first*.95+p.second*.76);
    maxBError=Math.max(maxBError,bp.distanceTo(target.point));}
   const points=[head,...hands,bp];
   const rotations=[...['L','R'].map(side=>a.visitor.rig!.bones[side+'_hand'].getWorldQuaternion(new T.Quaternion())),b.visitor.rig!.bones[sideB+'_hand'].getWorldQuaternion(new T.Quaternion())];
   if(previousRotations)maxHandAngle=Math.max(maxHandAngle,...rotations.map((q,i)=>q.angleTo(previousRotations![i])));
   previousRotations=rotations;
   if(previous){maxHeadStep=Math.max(maxHeadStep,head.distanceTo(previous[0]));
    const step=Math.max(...[...hands,bp].map((h,i)=>h.distanceTo(previous![i+1])));if(step>maxHandStep){maxHandStep=step;worstHandTime=time;}}
   previous=points;
   if(time>=1.4&&time<=8.65){const height=Math.min(...hands.map(h=>h.y-.65));if(height<minPalm){minPalm=height;minPalmTime=time;}}
   if(time>=3.85&&time<=6.35)maxGap=Math.max(maxGap,head.distanceTo(lapPillowHeadTarget(a.visitor,b.visitor)));
   maxHipY=Math.max(maxHipY,Math.abs(a.visitor.rig!.bones.hips.getWorldPosition(new T.Vector3()).y-startHip.y));
   expect(points.every(p=>p.toArray().every(Number.isFinite))).toBe(true);
   expect(a.visitor.root.position).toEqual(starts[0]);expect(b.visitor.root.position).toEqual(starts[1]);
  }

  expect(maxGap).toBeLessThan(.035);
  expect(minPalm,`palm below seat at ${minPalmTime}`).toBeGreaterThan(0);
  expect(maxBError).toBeLessThan(.08);
  expect(maxHandAngle).toBeLessThan(.4);
  Object.values(a.visitor.rig!.bones).forEach((b,i)=>expect(b.position).toEqual(bonePositions[i]));
  expect(maxHipY).toBeLessThan(.001);
  expect(maxHeadStep).toBeLessThan(.09);
  expect(maxHandStep,`hand jump at ${worstHandTime}`).toBeLessThan(.10);
  expect(a.visitor.getHeadWorldPosition().distanceTo(startHead)).toBeLessThan(.001);
  expect(a.visitor.rig!.bones.hips.getWorldPosition(new T.Vector3()).distanceTo(startHip)).toBeLessThan(.001);
 },20000);
});

it('keeps both actors seated while loading, playing, completing, cancelling and resetting',async()=>{
 const a=resident(-.6,1,0),b=resident(.6,1,0),postures:string[]=[];
 for(const r of [a,b])Object.assign(r.visitor,{
  motionScale:1,
  animate:(_t:number,_m:string,posture='standing')=>{postures.push(posture);r.reset();},
  finishPose:()=>{},setActionExpression:()=>{},
 });
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>clip} as Response);
 try{
  const scene=createSocialScene([{id:'a',visitor:a.visitor},{id:'b',visitor:b.visitor}],
   {sofaSeatPoses:{a:{kind:'social',hands:[]},b:{kind:'social',hands:[]}}});
  const loading=scene.start('home-sofa-lap-pillow','a','b');
  expect(postures).toEqual(['seated','seated']);
  await loading;
  for(let i=0;i<94;i++)scene.advance(.1);
  expect(scene.active).toBe(false);
  await scene.start('home-sofa-lap-pillow','a','b');scene.advance(2);scene.cancel();scene.reset();
  expect(new Set(postures)).toEqual(new Set(['seated']));
 }finally{fetchMock.mockRestore();}
});
