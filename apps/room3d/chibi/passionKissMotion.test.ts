import {createSocialScene,socialActions} from './selectedSocial';
import clip from '../../../public/room3d/motions/selected/home-passion-kiss.json';
import {it,expect,vi} from 'vitest';
import * as T from 'three';
import {ConvexHull} from 'three/examples/jsm/math/ConvexHull.js';
import {createBlankBody,BLANK_SCALE} from './blankBody';
import {bindBlankBody} from './blankRig';
import {createBlankMotion} from './blankMotion';
import type {ChibiVisitor} from './visitor';
import {planPassionKiss,posePassionKiss,passionKissPhase} from './passionKissMotion';
import {contactSolver} from './socialContact';
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
 const depth=(points:T.Vector3[],hull:ConvexHull)=>Math.max(0,...points.map(p=>Math.max(0,-Math.max(...hull.faces.map(f=>f.normal.dot(p)-f.constant)))));
 return Math.max(depth(ap,bh),depth(bp,ah));
}

for(const [ah,bh,as,bs] of [[1,1,1,1],[.8,1.25,.75,1.4],[1.25,.8,1.4,.75],[.9,1.1,1.04,1.04],[.8,.8,1.4,1.4],[1.25,.8,1.4,1.4],[1,1,1.2,1.2]])it(`grounded mutual kiss ${ah}/${bh}/${as}/${bs}`,()=>{
 const a=resident(ah,as),b=resident(bh,bs);a.root.position.z=3;
 const plan=planPassionKiss(a,b);expect(plan.error).toBeLessThan(.005);
 const both=[a,b].map(visitor=>({visitor,solver:contactSolver(visitor)}));
 let penetration=0,maxGap=0,maxStep=0,maxHandError=0,previous:T.Vector3[]|undefined;
 for(let frame=0;frame<=360;frame++){
  const t=frame/30;
  both.forEach(({visitor:v},i)=>{v.root.position.copy(plan.roots[i]).addScaledVector(plan.retreat,i===0?1-passionKissPhase(t).step:0);v.root.quaternion.copy(plan.headings[i]);v.animate(0,'idle');});
  const feet=both.map(({visitor:v})=>['L_toe','R_toe','L_foot','R_foot'].map(n=>v.rig!.bones[n].getWorldPosition(new T.Vector3())));
  const reports=posePassionKiss(both,t,plan);
  for(const r of reports)if(r.weight>.99)maxHandError=Math.max(maxHandError,r.report?.error??1);
  const support=['L_toe','R_toe'].map(n=>a.rig!.bones[n].getWorldPosition(new T.Vector3()).y);
  expect(Math.abs(Math.min(...support)-feet[0][0].y)).toBeLessThan(.015);
  const points=both.flatMap(({visitor:v},i)=>{
   if(i===1||t>=2&&t<=10)for(const [j,n] of ['L_toe','R_toe','L_foot','R_foot'].entries())expect(v.rig!.bones[n].getWorldPosition(new T.Vector3()).distanceTo(feet[i][j])).toBeLessThan(.0001);
   return ['head','R_hand','L_hand'].map(n=>v.rig!.bones[n].getWorldPosition(new T.Vector3()));
  });
  if(previous)maxStep=Math.max(maxStep,...points.map((p,i)=>p.distanceTo(previous![i])));previous=points;
  if(passionKissPhase(t).kiss===1)maxGap=Math.max(maxGap,a.rig!.bones.head.localToWorld(plan.mouths[0].clone()).distanceTo(b.rig!.bones.head.localToWorld(plan.mouths[1].clone())));
  if(frame%12===0)penetration=Math.max(penetration,headPenetration(a,b));
 }
 expect(maxHandError).toBeLessThan(.055);expect(maxGap).toBeLessThan(.025);expect(penetration).toBeLessThan(.02);expect(maxStep).toBeLessThan(.08);
},30000);

it('fits all editor heights and asymmetric head sizes without modifying character proportions',()=>{
 const cache=new Map<string,ChibiVisitor>();
 const get=(h:number,size:number,role:number)=>{
  const key=`${h}/${size}/${role}`;if(!cache.has(key))cache.set(key,resident(h,size));
  const v=cache.get(key)!;v.root.position.set(0,.18,role===0?3:0);v.root.quaternion.identity();v.animate(0,'idle');return v;
 };
 for(const ah of [.8,.9,1,1.1,1.25])for(const bh of [.8,.9,1,1.1,1.25])for(const [as,bs] of [[.75,1.4],[1.04,1.04],[1.4,.75],[1.4,1.4]]){
  const a=get(ah,as,0),b=get(bh,bs,1),label=`${ah}/${bh}/${as}/${bs}`;
  const before=[a,b].map(v=>Object.values<T.Bone>(v.rig!.bones).map(b=>b.position.clone()));
  const plan=planPassionKiss(a,b);expect(plan.error,label).toBeLessThan(.005);
  const both=[a,b].map((v,i)=>{v.root.position.copy(plan.roots[i]);v.root.quaternion.copy(plan.headings[i]);v.animate(0,'idle');return {visitor:v,solver:contactSolver(v)};});
  const reports=posePassionKiss(both,3,plan);
  expect(headPenetration(a,b),label).toBeLessThan(.02);
  expect(a.rig!.bones.head.localToWorld(plan.mouths[0].clone()).distanceTo(b.rig!.bones.head.localToWorld(plan.mouths[1].clone())),label).toBeLessThan(.025);
  for(const r of reports)expect(r.report!.error,label).toBeLessThan(.055);
  [a,b].forEach((v,i)=>{expect(v.rig!.bodyHeight).toBe(i===0?ah:bh);Object.values<T.Bone>(v.rig!.bones).forEach((b,j)=>expect(b.position).toEqual(before[i][j]));});
 }
},30000);

for(const [ah,bh,size=1] of [[1,1],[.8,1.25],[1.25,.8],[.8,.8,1.4],[1.25,.8,1.4]])it(`plays the independent 12-second scene, including approach and recovery ${ah}/${bh}`,async()=>{
 const a=resident(ah,size),b=resident(bh,size);a.root.position.set(0,.18,-3);
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>clip} as Response);
 try{
  expect(socialActions[clip.id].duration).toBe(12);
  const scene=createSocialScene([{id:'a',visitor:a},{id:'b',visitor:b}],{findPath:(f,t)=>[f.clone(),t.clone()]});
  await scene.start(clip.id,'a','b');const duration=scene.inspect().session!.duration,approach=duration-12;
  expect(approach).toBeGreaterThan(0);
  let locked:T.Vector3[]|undefined,penetration=0,prev:T.Vector3[]|undefined,maxStep=0;
  for(let frame=1;frame<=Math.ceil(duration*30);frame++){
   scene.advance(1/30);const t=frame/30-approach;
   const points=[a.getHeadWorldPosition(),b.getHeadWorldPosition()];
   if(prev)maxStep=Math.max(maxStep,...points.map((p,i)=>p.distanceTo(prev![i])));prev=points;
   if(t>=2&&t<=10){if(!locked)locked=[a,b].map(v=>v.root.position.clone());[a,b].forEach((v,i)=>expect(v.root.position.distanceTo(locked![i])).toBeLessThan(.00001));}
   if(frame%12===0)penetration=Math.max(penetration,headPenetration(a,b));
  }
  expect(maxStep).toBeLessThan(.11);expect(penetration).toBeLessThan(.02);expect(scene.active).toBe(false);
  const end=[a,b].map(v=>v.getHeadWorldPosition());scene.cancel();[a,b].forEach((v,i)=>expect(v.getHeadWorldPosition().distanceTo(end[i])).toBeLessThan(.001));
 }finally{fetchMock.mockRestore();}
},30000);

it('keeps original clocks and gives the new kiss its own category and two-contact rhythm',()=>{
 expect(socialActions[clip.id]).toMatchObject({category:'kiss',label:'热吻',duration:12});
 expect(socialActions['home-kiss'].duration).toBe(9.6);
 expect(socialActions['home-sneak-kiss'].duration).toBe(5);
 expect(passionKissPhase(3).kiss).toBe(1);
 expect(passionKissPhase(5).kiss).toBeLessThan(1);
 expect(passionKissPhase(6).kiss).toBe(1);
 for(const value of Object.values(passionKissPhase(12)))expect(value===0||value===1).toBe(true);
 expect(passionKissPhase(12).hands).toBe(0);expect(passionKissPhase(12).height).toBe(0);
});
