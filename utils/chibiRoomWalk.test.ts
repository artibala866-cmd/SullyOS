import {it,expect} from 'vitest';
import * as T from 'three';
import {createBlankBody,BLANK_SCALE} from '../apps/room3d/chibi/blankBody';
import {bindBlankBody} from '../apps/room3d/chibi/blankRig';
import {createBlankMotion} from '../apps/room3d/chibi/blankMotion';
import {bodyHeightY} from '../apps/room3d/chibi/bodyHeight';
import {createDistanceWalkClock,createRoomWalkSampler,roomWalkSpeed} from '../apps/room3d/chibi/roomWalk';
import {createWorldFootLock,captureLegSupport,restoreLegSupport} from '../apps/room3d/chibi/legContactIK';
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

it('hands the stance to the grounded opposite foot instead of dragging the pelvis',()=>{
 const root=new T.Group(),left=new T.Bone(),right=new T.Bone();
 left.name='L_toe';right.name='R_toe';right.position.y=.012;
 const hip=new T.Bone(),knee=new T.Bone(),ankle=new T.Bone();
 hip.position.set(-.12,.80,0);knee.position.y=-.40;ankle.position.y=-.35;
 root.add(left,right,hip);hip.add(knee);knee.add(ankle);
 const rig={bones:{L_toe:left,R_toe:right,L_thigh:hip,L_shin:knee,L_foot:ankle}} as any;
 const footLock=createWorldFootLock();
 footLock.apply({root,rig},0,1);
 expect(footLock.supportSide).toBe('L');
 root.position.z=.42;
 footLock.apply({root,rig},.31,1);
 expect(footLock.supportSide).toBe('R');
 expect(footLock.targetWorld!.distanceTo(right.getWorldPosition(new T.Vector3()))).toBeLessThan(1e-8);
});

it('world-space planted toe IK reduces real moving-rig drift at rotated headings',()=>{
 for(const bodyHeight of [.8,1,1.25])for(const angle of [0,Math.PI/2]){
  const root=new T.Group(),body=new T.Group(),hair=new T.Group();
  const mesh=new T.Mesh(createBlankBody('skin',{bodyHeight}),new T.MeshBasicMaterial());
  root.scale.setScalar(2.8/BLANK_SCALE);root.rotation.y=angle;root.add(body);body.add(mesh,hair);
  const rig=bindBlankBody(mesh,hair,true),animate=createBlankMotion(rig,body,{walk:approvedRoomWalk});
  const clock=createDistanceWalkClock(),lock=createWorldFootLock();
  const translatePose=(delta:T.Vector3)=>{
   const from=root.worldToLocal(new T.Vector3());
   const to=root.worldToLocal(delta.clone());
   body.position.add(to.sub(from));
   root.updateWorldMatrix(true,true);
  };
  const speed=roomWalkSpeed(approvedRoomWalk,rig.bones)*root.scale.y;
  const initialLengths=rig.skeleton.bones.map(b=>b.position.length());
  let raw=0,corrected=0,tracked=0,relocks=0;
  for(let i=0;i<=90;i++){
   const time=i/60;
   root.position.set(Math.sin(angle)*time*speed,0,Math.cos(angle)*time*speed);
   root.updateWorldMatrix(true,true);
   animate(clock.sample(root.getWorldPosition(new T.Vector3()),time,speed),'walk','standing');
   root.updateWorldMatrix(true,true);
   const side=lock.supportSide,target=lock.targetWorld;
   const before=side&&target?rig.bones[side+'_toe'].getWorldPosition(new T.Vector3()).distanceTo(target):0;
   lock.apply({root,rig,translatePose},time,speed);
   const stillSameTarget=side!==null&&side===lock.supportSide&&target!==null&&
    lock.targetWorld!.distanceTo(target)<1e-9;
   if(stillSameTarget&&before>.004){
    raw+=before;
    corrected+=rig.bones[side+'_toe'].getWorldPosition(new T.Vector3()).distanceTo(target);
    tracked++;
   }else if(side!==null&&side===lock.supportSide&&!stillSameTarget)relocks++;
   expect(rig.skeleton.bones.map(b=>b.position.length())).toEqual(initialLengths);
  }
  expect(tracked).toBeGreaterThan(5);
  // Only compare frames against the SAME physical world anchor. A reset or
  // stance transfer creates a new target; measuring against the old one
  // incorrectly counts a legitimate step as foot sliding.
  expect(corrected, `height ${bodyHeight} angle ${angle} relocks ${relocks}`).toBeLessThan(raw*.5);
  expect(relocks).toBeLessThan(6);
  lock.reset();
  expect(lock.supportSide).toBeNull();
  mesh.geometry.dispose();mesh.material.dispose();rig.skeleton.dispose();
 }
});


it('restores planted sole orientation after knee IK under a rotated scaled parent',()=>{
 for(const height of [.8,1,1.25]){
  const root=new T.Group(),body=new T.Group(),hair=new T.Group();
  root.scale.setScalar(.8);root.rotation.y=1.1;root.add(body);
  const mesh=new T.Mesh(createBlankBody('skin',{bodyHeight:height}),new T.MeshBasicMaterial());body.add(mesh,hair);
  const rig=bindBlankBody(mesh,hair,true),animate=createBlankMotion(rig,body);
  const visitor={root,rig,translatePose:(delta:T.Vector3)=>{body.position.add(root.worldToLocal(delta.clone()).sub(root.worldToLocal(new T.Vector3())));}} as any;
  animate(0,'idle','standing');root.updateWorldMatrix(true,true);
  const support=captureLegSupport(visitor)!;
  const lengths=rig.skeleton.bones.map(b=>b.position.length());
  for(const side of ['L','R']){rig.bones[side+'_thigh'].rotation.x-=.25;rig.bones[side+'_shin'].rotation.x+=.5;}
  restoreLegSupport(visitor,support);
  for(const [i,side] of ['L','R'].entries()){
   expect(rig.bones[side+'_foot'].getWorldQuaternion(new T.Quaternion()).angleTo(support.rotations[i])).toBeLessThan(1e-6);
  }
  expect(rig.skeleton.bones.map(b=>b.position.length())).toEqual(lengths);
  mesh.geometry.dispose();mesh.material.dispose();rig.skeleton.dispose();
 }
});

it('does not re-anchor an explicitly planted furniture foot on duplicate animation timestamps',()=>{
 const root=new T.Group(),body=new T.Group(),hair=new T.Group(),mesh=new T.Mesh(createBlankBody('skin'),new T.MeshBasicMaterial());
 root.add(body);body.add(mesh,hair);
 const rig=bindBlankBody(mesh,hair,true),animate=createBlankMotion(rig,body),lock=createWorldFootLock();
 const translatePose=(delta:T.Vector3)=>{body.position.add(root.worldToLocal(delta.clone()).sub(root.worldToLocal(new T.Vector3())));};
 const actor={root,rig,translatePose};
 animate(.5,'idle','standing');root.updateWorldMatrix(true,true);
 lock.apply(actor,.5,1.05,true,'R');
 const first=lock.targetWorld;
 expect(lock.supportSide).toBe('R');expect(first).not.toBeNull();
 root.position.z-=.08;
 animate(.5,'idle','standing');root.updateWorldMatrix(true,true);
 lock.apply(actor,.5,1.05,true,'R');
 expect(lock.supportSide).toBe('R');
 expect(lock.targetWorld!.distanceTo(first!)).toBeLessThan(1e-6);
 animate(.65,'idle','standing');lock.apply(actor,.65,1.05,true,'R');
 expect(lock.targetWorld!.distanceTo(first!)).toBeLessThan(1e-6);
 lock.reset();
 expect(lock.supportSide).toBeNull();
 mesh.geometry.dispose();mesh.material.dispose();rig.skeleton.dispose();
});
