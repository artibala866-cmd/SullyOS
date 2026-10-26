import {describe,it,expect,vi} from 'vitest';
import * as T from 'three';
import {ConvexHull} from 'three/examples/jsm/math/ConvexHull.js';
import {createBlankBody,BLANK_SCALE} from './blankBody';
import {bindBlankBody} from './blankRig';
import {createBlankMotion} from './blankMotion';
import type {ChibiVisitor} from './visitor';
import {planSneakKiss,poseSneakKiss,sneakKissPhase,sneakKissExpression} from './sneakKissMotion';
import {selectedMotions} from './selectedMotions';
import {createSocialScene,socialActions} from './selectedSocial';
import clip from '../../../public/room3d/motions/selected/home-sneak-kiss.json';

function resident(height=1,headSize=1,scale=1){
 const root=new T.Group(),scaled=new T.Group(),body=new T.Group();root.add(scaled);scaled.add(body);
 const original=new T.Mesh(createBlankBody('skin',{bodyHeight:height,headSize}),new T.MeshBasicMaterial());body.add(original);
 // Production binds in model space BEFORE the home-size scale is applied.
 const rig=bindBlankBody(original,new T.Group(),true);
 scaled.scale.setScalar(2.8/BLANK_SCALE*scale);root.position.y=.18;
 const animate=createBlankMotion(rig,body);
 const visitor={root,rig,motionScale:1,walkSpeed:1.05,seatOffset:0,
  animate:(t:number,motion:any,posture:any='standing',activity?:any)=>{animate(t,motion,posture,activity);root.updateWorldMatrix(true,true);},
  getHeadWorldPosition:()=>rig.bones.head.localToWorld(new T.Vector3(0,.72,0)),
  getHeadTopWorldPosition:()=>rig.bones.head.localToWorld(new T.Vector3(0,1.4,0)),
  translatePose:(d:T.Vector3)=>{scaled.updateWorldMatrix(true,false);body.position.add(scaled.worldToLocal(d.clone()).sub(scaled.worldToLocal(new T.Vector3())));root.updateWorldMatrix(true,true);},
  finishPose:()=>{},setActionExpression:()=>{},
 } as unknown as ChibiVisitor;
 visitor.animate(0,'idle');return visitor;
}
function headVertices(v:ChibiVisitor){
 const rig=v.rig!,g=rig.mesh.geometry,indices=g.getAttribute('skinIndex'),weights=g.getAttribute('skinWeight');
 const headIndex=rig.skeleton.bones.indexOf(rig.bones.head),points:T.Vector3[]=[];
 v.root.updateMatrixWorld(true);rig.skeleton.update();
 for(let i=0;i<indices.count;i++){
  if(![0,1,2,3].some(k=>indices.getComponent(i,k)===headIndex&&weights.getComponent(i,k)>.9))continue;
  points.push(rig.mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(rig.mesh.matrixWorld));
 }
 return points;
}
function headPenetration(a:ChibiVisitor,b:ChibiVisitor){
 const ap=headVertices(a),bp=headVertices(b),ah=new ConvexHull().setFromPoints(ap),bh=new ConvexHull().setFromPoints(bp);
 const depth=(points:T.Vector3[],hull:ConvexHull)=>Math.max(0,...points.map(p=>Math.max(0,-Math.max(...hull.faces.map(f=>f.distanceToPoint(p))))));
 return Math.max(depth(ap,bh),depth(bp,ah));
}
describe('five-second surprise cheek kiss',()=>{
 it('registers only in kiss, with one shared five-second clock and delayed B response',()=>{
  expect(selectedMotions.find(x=>x.id===clip.id)).toMatchObject({label:'偷亲',category:'kiss',duration:5,participants:2});
  expect(socialActions[clip.id].duration).toBe(5);
  expect(sneakKissPhase(1.85).kiss).toBe(1);expect(sneakKissPhase(2.15).kiss).toBe(1);
  expect(sneakKissPhase(2.34).reaction).toBe(0);expect(sneakKissPhase(2.6).reaction).toBeGreaterThan(0);
  expect(sneakKissExpression(1,2)).toBe('neutral');expect(sneakKissExpression(1,2.4)).toBe('surprised');
  expect(sneakKissExpression(1,3)).toBe('smiling');expect(sneakKissPhase(5).kiss).toBe(0);
 });
 for(const [ah,bh,size,side,yaw,receiverSize=1] of [[1,1,1,1,0],[1.15,.85,1,-1,1.2],[.95,1.05,1.15,1,-.8],[1,1,1.2,-1,Math.PI],[1,1,1.4,1,2.1],[1,1,.75,-1,.6],[.8,1.25,.75,1,1.1,1.4],[1.25,.8,1.4,-1,-.4,.75],[.9,1.1,1.04,-1,.7,1.04]]){
  it(`grounds feet and contacts a cheek without skull overlap: ${[ah,bh,size,side,yaw]}`,()=>{
   const a=resident(ah,size),b=resident(bh,receiverSize);b.root.rotation.y=yaw;b.animate(0,'idle');
   a.root.position.x=-2;
   const before=b.rig!.bones.head.quaternion.clone(),positions=Object.values(a.rig!.bones).map(b=>b.position.clone());
   const plan=planSneakKiss(a,b,side as 1|-1);expect(b.rig!.bones.head.quaternion.angleTo(before)).toBeLessThan(1e-6);
   expect(plan.error).toBeLessThan(.045);
   let previous:T.Vector3[]|undefined,maxStep=0,maxGap=0,maxFloor=0,penetration=0,maxSupportLift=0;
   let receiverBefore:T.Quaternion|undefined;
   for(let frame=0;frame<=150;frame++){
    const t=frame/30,p=sneakKissPhase(t);
    a.root.position.copy(plan.stance).addScaledVector(plan.step,p.step);a.root.quaternion.copy(plan.heading);
    a.animate(0,'idle');b.animate(0,'idle');
    const floor=a.rig!.bones.L_toe.getWorldPosition(new T.Vector3()).y;
    const bFloor=b.rig!.bones.L_toe.getWorldPosition(new T.Vector3()).y;
    poseSneakKiss(a,b,t,plan);
    const mouth=a.rig!.bones.head.localToWorld(plan.mouth.clone()),target=b.rig!.bones.head.localToWorld(plan.cheek.clone());
    const points=[a.getHeadWorldPosition(),...['L_toe','R_toe','R_hand'].map(n=>a.rig!.bones[n].getWorldPosition(new T.Vector3())),b.getHeadWorldPosition()];
    for(const side of ['L','R'])expect(b.rig!.bones[side+'_toe'].getWorldPosition(new T.Vector3()).y).toBeCloseTo(bFloor,4);
    if(previous)maxStep=Math.max(maxStep,...points.map((p,i)=>p.distanceTo(previous![i])));previous=points;
    if(t>=1.85&&t<=2.15){maxGap=Math.max(maxGap,mouth.distanceTo(target));maxFloor=Math.max(maxFloor,...points.slice(1,3).map(p=>Math.abs(p.y-floor)));}
    maxSupportLift=Math.max(maxSupportLift,Math.abs(Math.min(points[1].y,points[2].y)-floor));
    if(frame%6===0)penetration=Math.max(penetration,headPenetration(a,b));
    if(frame===20)receiverBefore=b.rig!.bones.head.quaternion.clone();
    if(t>.7&&t<2.35)expect(b.rig!.bones.head.quaternion.angleTo(receiverBefore!)).toBeLessThan(1e-6);
    expect(points.every(p=>p.toArray().every(Number.isFinite))).toBe(true);
   }
   expect(maxGap).toBeLessThan(.05);expect(maxFloor).toBeLessThan(.01);expect(maxSupportLift).toBeLessThan(.015);
   expect(penetration).toBeLessThan(.025);expect(maxStep).toBeLessThan(.09);
   Object.values(a.rig!.bones).forEach((b,i)=>expect(b.position).toEqual(positions[i]));
  },20000);
 }
 it('adapts a short initiator to a tall recipient without changing either stature',()=>{
  const a=resident(.8),b=resident(1.2);const bPose=b.rig!.bones.head.quaternion.clone();
  const plan=planSneakKiss(a,b,1);expect(plan.error).toBeLessThan(.005);
  expect(plan.receiverKnee).toBeGreaterThan(0);
  expect(b.rig!.bones.head.quaternion.angleTo(bPose)).toBeLessThan(1e-6);
 });
});

for(const [actorHeight,receiverHeight] of [[1,1],[.8,1.25],[1.25,.8]])
it(`plays navigation, height adaptation and delayed reactions: ${actorHeight}/${receiverHeight}`,async()=>{
 const a=resident(actorHeight),b=resident(receiverHeight);a.root.position.set(0,.18,-2);
 const bStart=b.root.position.clone(),expressions:Array<[number,string]>=[];
 let actionTime=-10;
 b.setActionExpression=(expression)=>{expressions.push([actionTime,expression]);};
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>clip} as Response);
 try{
  const scene=createSocialScene([{id:'a',visitor:a},{id:'b',visitor:b}],{findPath:(from,to)=>[from.clone(),to.clone()]});
  await scene.start(clip.id,'a','b');
  const duration=scene.inspect().session!.duration,approach=duration-5;
  let previous=a.root.position.clone(),maxStep=0,penetration=0;
  for(let frame=1;frame<=Math.ceil(duration*30);frame++){
   actionTime=Math.min(frame/30,duration)-approach;
   scene.advance(1/30);
   expect(b.root.position).toEqual(bStart);
   maxStep=Math.max(maxStep,a.root.position.distanceTo(previous));previous.copy(a.root.position);
   if(frame%6===0)penetration=Math.max(penetration,headPenetration(a,b));
   expect(a.root.position.y).toBeCloseTo(.18);
  }
  expect(penetration).toBeLessThan(.025);expect(maxStep).toBeLessThan(.055);
  expect(expressions.filter(([t])=>t>=0&&t<2.15).every(([,e])=>e==='neutral')).toBe(true);
  expect(expressions.some(([t,e])=>t>=2.15&&e==='surprised')).toBe(true);
  expect(expressions.some(([t,e])=>t>=2.85&&e==='smiling')).toBe(true);
  expect(scene.active).toBe(false);
  const end=a.getHeadWorldPosition();scene.cancel();expect(a.getHeadWorldPosition().distanceTo(end)).toBeLessThan(.001);
 }finally{fetchMock.mockRestore();}
},20000);

it('refuses only blocked approaches without teleporting either actor',async()=>{
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>clip} as Response);
 try{
  for(const differentHeights of [true,false]){
   const a=resident(differentHeights?.8:1),b=resident(differentHeights?1.2:1);a.root.position.x=-2;
   const starts=[a.root.position.clone(),b.root.position.clone()],turns=[a.root.quaternion.clone(),b.root.quaternion.clone()];
   const scene=createSocialScene([{id:'a',visitor:a},{id:'b',visitor:b}],{findPath:()=>null});
   await expect(scene.start(clip.id,'a','b')).rejects.toThrow(/空地/);
   expect(scene.active).toBe(false);
   for(const [i,v] of [a,b].entries()){expect(v.root.position).toEqual(starts[i]);expect(v.root.quaternion.angleTo(turns[i])).toBeLessThan(1e-6);}
  }
 }finally{fetchMock.mockRestore();}
});

it('fits the full character-editor height range with unequal head sizes, without changing settings or bone lengths',()=>{
 const residents=new Map<string,ChibiVisitor>();
 const get=(height:number,size:number,role:string)=>{
  const key=`${height}:${size}:${role}`;
  if(!residents.has(key))residents.set(key,resident(height,size));
  const v=residents.get(key)!;v.root.position.set(role==='A'?-2:0,.18,0);v.root.quaternion.identity();v.animate(0,'idle');return v;
 };
 for(const ah of [.8,.9,1,1.1,1.25])for(const bh of [.8,.9,1,1.1,1.25])for(const [as,bs] of [[.75,1.4],[1.04,1.04],[1.4,.75]]){
  const a=get(ah,as,'A'),b=get(bh,bs,'B');
  const snapshots=[a,b].map(v=>({height:v.rig!.bodyHeight,size:v.rig!.mesh.geometry.userData.headSize,
   scale:v.rig!.bones.head.getWorldScale(new T.Vector3()),positions:Object.values(v.rig!.bones).map(b=>b.position.clone())}));
  const plan=planSneakKiss(a,b,1),label=`A ${ah}/${as}, B ${bh}/${bs}`;
  expect(plan.surfaceValid,label).toBe(true);expect(plan.error,label).toBeLessThan(.005);
  a.root.position.copy(plan.stance).add(plan.step);a.root.quaternion.copy(plan.heading);
  a.animate(0,'idle');b.animate(0,'idle');
  const floors=[a,b].map(v=>v.rig!.bones.L_toe.getWorldPosition(new T.Vector3()).y);
  poseSneakKiss(a,b,2,plan);
  const gap=a.rig!.bones.head.localToWorld(plan.mouth.clone()).distanceTo(b.rig!.bones.head.localToWorld(plan.cheek.clone()));
  expect(gap,label).toBeLessThan(.025);
  [a,b].forEach((v,i)=>{
   expect(v.rig!.bodyHeight).toBe(snapshots[i].height);expect(v.rig!.mesh.geometry.userData.headSize).toBe(snapshots[i].size);
   expect(v.rig!.bones.head.getWorldScale(new T.Vector3()).distanceTo(snapshots[i].scale)).toBeLessThan(1e-6);
   Object.values(v.rig!.bones).forEach((bone,j)=>expect(bone.position).toEqual(snapshots[i].positions[j]));
   for(const side of ['L','R'])expect(v.rig!.bones[side+'_toe'].getWorldPosition(new T.Vector3()).y,floors[i].toString()).toBeCloseTo(floors[i],4);
  });
 }
},30000);
