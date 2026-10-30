import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createSocialScene,socialActions,halloweenActorFacing} from '../apps/room3d/chibi/selectedSocial';
import {sampleSelected} from '../apps/room3d/chibi/selectedMotions';
import {splitMotionHeading} from '../apps/room3d/chibi/motionHeading';
import type {ChibiVisitor} from '../apps/room3d/chibi/visitor';

const ids=['halloween-boo','halloween-trick-or-treat','halloween-candy-shower','halloween-ghost-tease'] as const;
const clips=Object.fromEntries(ids.map(id=>[id,JSON.parse(readFileSync('public/room3d/motions/selected/'+id+'.json','utf8'))]));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const degrees=(a:T.Vector3,b:T.Vector3)=>a.angleTo(b)*180/Math.PI;
function actor(position:T.Vector3,scale=1){
 const root=new T.Group();root.position.copy(position);
 const pelvis=new T.Quaternion();
 const visitor={root,motionScale:scale*.4,walkSpeed:1.05,
  animate:()=>{pelvis.identity();},finishPose:()=>{},setActionExpression:()=>{},
  classicPoint:()=>new T.Vector3(),classicContact:()=>{},
  applySelectedFrame:(frame:any,weight:number)=>{pelvis.identity().slerp(frame.rotations.hips,weight);}
 } as unknown as ChibiVisitor;
 return {visitor,forward:()=>new T.Vector3(0,0,1).applyQuaternion(pelvis).applyQuaternion(root.quaternion)};
}
it('keeps source lean, and makes all four real clips face the actual partner',()=>{
 for(const id of ids)for(let i=0;i<2;i++){
  const clip=clips[id],track=clip.actors[i],other=clip.actors[1-i];
  const own=new T.Vector3().fromArray(track.positions),target=new T.Vector3().fromArray(other.positions);
  const first=sampleSelected(track,0).rotations.hips;
  for(const time of [0,1.8,3.4,5.8,7.9]){
   const current=sampleSelected(track,time).rotations.hips,{heading,lean}=splitMotionHeading(current);
   const root=halloweenActorFacing(heading,first,own,target);
   const forward=new T.Vector3(0,0,1).applyQuaternion(lean).applyQuaternion(root).setY(0).normalize();
   const toward=target.clone().sub(own).setY(0).normalize();
   expect(degrees(forward,toward),id+' actor='+i+' t='+time).toBeLessThan(6);
   expect(heading.clone().multiply(lean).angleTo(current)).toBeLessThan(1e-5);
  }
 }
});
it('turns before action without a 180-degree snap: swap roles, horizontal axes and heights',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>clips[ids.find(id=>url.includes(id))!]})));
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async()=>({scene:new T.Group()} as any));
 for(const id of ids)for(const reverse of [false,true])for(const bearing of [0,Math.PI/4,Math.PI/2,Math.PI])for(const scales of [[1,1],[.8,1.2],[1.2,.8]]){
  const direction=new T.Vector3(Math.sin(bearing),0,Math.cos(bearing));
  const residents=[actor(direction.clone().multiplyScalar(-1.7),scales[0]),actor(direction.clone().multiplyScalar(1.7),scales[1])];
  const parent=new T.Group();residents.forEach(r=>parent.add(r.visitor.root));
  const runtime=createSocialScene(residents.map((r,i)=>({id:String(i),visitor:r.visitor})));
  const a=reverse?'1':'0',b=reverse?'0':'1';
  await runtime.start(id,a,b);
  const approach=runtime.inspect().session!.duration-socialActions[id].duration;
  const angles:number[][]=[[],[]];
  for(let n=0;n<=24;n++){
   runtime.seek(approach-.72+n*.72/24);
   residents.forEach((r,i)=>angles[i].push(Math.atan2(r.forward().x,r.forward().z)));
  }
  for(const values of angles)for(let n=1;n<values.length;n++)
   expect(Math.abs(Math.atan2(Math.sin(values[n]-values[n-1]),Math.cos(values[n]-values[n-1]))),id+' turn').toBeLessThan(.32);
  for(const t of [.05,1.8,3.2,5.6,7.8]){
   runtime.seek(approach+.6+t);
   for(let i=0;i<2;i++){
    const toward=residents[1-i].visitor.root.position.clone().sub(residents[i].visitor.root.position).setY(0).normalize();
    expect(degrees(residents[i].forward().setY(0).normalize(),toward),id+' role='+i+' t='+t).toBeLessThan(15);
   }
  }
  runtime.cancel();expect(runtime.inspect().session).toBeNull();
  await runtime.start(id,b,a);runtime.seek(2);runtime.cancel();
  expect(runtime.inspect().session).toBeNull();
 }
},120_000);
