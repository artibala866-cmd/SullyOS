import {it,expect} from 'vitest';
import * as T from 'three';
import {createBlankBody,BLANK_SCALE} from '../apps/room3d/chibi/blankBody';
import {bindBlankBody} from '../apps/room3d/chibi/blankRig';
import {createBlankMotion} from '../apps/room3d/chibi/blankMotion';
import {bodyHeightY} from '../apps/room3d/chibi/bodyHeight';
import {createDistanceWalkClock,createRoomWalkSampler,roomWalkSpeed} from '../apps/room3d/chibi/roomWalk';
import {createWorldFootLock} from '../apps/room3d/chibi/legContactIK';
import {approvedRoomWalk} from '../apps/room3d/chibi/approvedRoomWalk';

it('plays the selected Meshy walk on the real rig with fixed bone lengths and grounded lower ankle, then restores idle',()=>{
 for(const bodyHeight of [.8,1,1.25]){
  const body=new T.Group(),hair=new T.Group(),geometry=createBlankBody('skin',{bodyHeight}),material=new T.MeshBasicMaterial(),mesh=new T.Mesh(geometry,material);body.add(mesh,hair);
  const rig=bindBlankBody(mesh,hair,true),options={walk:approvedRoomWalk},animate=createBlankMotion(rig,body,options),lengths=rig.skeleton.bones.map(b=>b.position.length());
  for(const clip of [approvedRoomWalk]){
   options.walk=clip;const speed=roomWalkSpeed(clip,rig.bones);expect(speed).toBeGreaterThan(.2);expect(speed).toBeLessThan(8);
   for(let t=0;t<clip.duration*2;t+=.07){
    animate(t,'walk','standing');expect(rig.skeleton.bones.map(b=>b.position.length())).toEqual(lengths);
    expect(rig.skeleton.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite))).toBe(true);
    const lowest=Math.min(...['L_foot','R_foot'].map(n=>rig.bones[n].getWorldPosition(new T.Vector3()).y));
    expect(lowest).toBeCloseTo(bodyHeightY(.049*BLANK_SCALE,bodyHeight),5);
   }
   animate(0,'idle','standing');expect(body.position.length()).toBeLessThan(1e-6);
  }
  geometry.dispose();material.dispose();rig.skeleton.dispose();
 }
});
it('loops the daily walk with normalized rotations',()=>{

 for(const clip of [approvedRoomWalk]){
  const pose=Object.fromEntries(Object.keys(clip.tracks).map(n=>[n,new T.Quaternion()])),sample=createRoomWalkSampler(clip);
  sample(.25,pose);const before=pose.L_thigh.clone();sample(.25+clip.duration,pose);expect(before.angleTo(pose.L_thigh)).toBeLessThan(1e-6);
  expect(Object.values(pose).every(q=>Math.abs(q.length()-1)<1e-5)).toBe(true);
 }
});

it('distance clock agrees at 30/60/120 Hz and resets discontinuities',()=>{
 const run=(hz:number)=>{
  const clock=createDistanceWalkClock(),position=new T.Vector3(),speed=1.2;
  let phase=0;
  for(let i=0;i<=hz*3;i++){position.x=i*speed/hz;phase=clock.sample(position,i/hz,speed);}
  return phase;
 };
 for(const hz of [30,60,120])expect(run(hz)).toBeCloseTo(3,5);
 const clock=createDistanceWalkClock(),point=new T.Vector3();
 expect(clock.sample(point,0,1)).toBe(0);
 point.x=.25;expect(clock.sample(point,.25,1)).toBeCloseTo(.25,8);
 point.x=100;expect(clock.sample(point,.5,1)).toBeCloseTo(.25,8);
 expect(clock.sample(point,-1,1)).toBe(0);
 clock.reset();expect(clock.sample(point,0,1)).toBe(0);
});

it('world-space planted toe IK reduces real moving-rig drift at rotated headings',()=>{
 for(const bodyHeight of [.8,1,1.25])for(const angle of [0,Math.PI/2]){
  const root=new T.Group(),body=new T.Group(),hair=new T.Group();
  const mesh=new T.Mesh(createBlankBody('skin',{bodyHeight}),new T.MeshBasicMaterial());
  root.scale.setScalar(2.8/BLANK_SCALE);root.rotation.y=angle;root.add(body);body.add(mesh,hair);
  const rig=bindBlankBody(mesh,hair,true),animate=createBlankMotion(rig,body,{walk:approvedRoomWalk});
  const clock=createDistanceWalkClock(),lock=createWorldFootLock();
  const speed=roomWalkSpeed(approvedRoomWalk,rig.bones)*root.scale.y;
  const initialLengths=rig.skeleton.bones.map(b=>b.position.length());
  let anchor:T.Vector3|null=null,side:'L'|'R'|null=null,raw=0,corrected=0,tracked=0;
  for(let i=0;i<=90;i++){
   const time=i/60;
   root.position.set(Math.sin(angle)*time*speed,0,Math.cos(angle)*time*speed);
   root.updateWorldMatrix(true,true);
   animate(clock.sample(root.getWorldPosition(new T.Vector3()),time,speed),'walk','standing');
   root.updateWorldMatrix(true,true);
   if(side&&anchor){
    const now=rig.bones[side+'_toe'].getWorldPosition(new T.Vector3());
    const rawDistance=now.distanceTo(anchor);
    lock.apply({root,rig},time,speed);
    if(lock.supportSide===side&&rawDistance>.004){
     const after=rig.bones[side+'_toe'].getWorldPosition(new T.Vector3()).distanceTo(anchor);
     raw+=rawDistance;corrected+=after;tracked++;
    }
   }else lock.apply({root,rig},time,speed);
   if(side!==lock.supportSide){side=lock.supportSide;anchor=side?rig.bones[side+'_toe'].getWorldPosition(new T.Vector3()):null;}
   expect(rig.skeleton.bones.map(b=>b.position.length())).toEqual(initialLengths);
  }
  expect(tracked).toBeGreaterThan(5);
  expect(corrected).toBeLessThan(raw*.5);
  lock.reset();
  expect(lock.supportSide).toBeNull();
  mesh.geometry.dispose();mesh.material.dispose();rig.skeleton.dispose();
 }
});
