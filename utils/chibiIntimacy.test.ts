import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {createBlankBody,BLANK_SCALE} from '../apps/room3d/chibi/blankBody';
import {bindBlankBody} from '../apps/room3d/chibi/blankRig';
import {createBlankMotion} from '../apps/room3d/chibi/blankMotion';
import {contactSolver} from '../apps/room3d/chibi/socialContact';
import {poseIntimacy} from '../apps/room3d/chibi/intimacyMotion';
import {princessCarryPhase,princessCarrySupports,assessPrincessCarryReach} from '../apps/room3d/chibi/princessCarryMotion';
import type {MotionFrame} from '../apps/room3d/chibi/selectedMotions';
import type {ChibiVisitor} from '../apps/room3d/chibi/visitor';
import {createSocialScene,socialActions} from '../apps/room3d/chibi/selectedSocial';
import {furniturePalm} from '../apps/room3d/chibi/furnitureMotion';
import {BLANK_FINGERS} from '../apps/room3d/chibi/blankFingers';

function actor(height:number,z:number,angle:number){
 const root=new T.Group(),body=new T.Group(),hair=new T.Group();root.scale.setScalar(2.8/BLANK_SCALE);root.position.z=z;root.rotation.y=angle;root.add(body);
 const mesh=new T.Mesh(createBlankBody('skin',{bodyHeight:height}),new T.MeshBasicMaterial());body.add(mesh,hair);
 const rig=bindBlankBody(mesh,hair,true),animate=createBlankMotion(rig,body);
 const visitor={root,rig,motionScale:1,animate:(time:number,motion:any='idle',posture:any='standing',activity:any=undefined)=>animate(time,motion,posture,activity),setActionExpression:vi.fn(),applySelectedFrame:vi.fn(),finishPose:()=>root.updateWorldMatrix(true,true),translatePose(delta:T.Vector3){const start=root.worldToLocal(new T.Vector3()),end=root.worldToLocal(delta.clone());body.position.add(end.sub(start));root.updateWorldMatrix(true,true);}} as unknown as ChibiVisitor;
 const reset=()=>{animate(0,'idle','standing');root.updateWorldMatrix(true,true);};reset();
 return {visitor,solver:contactSolver(visitor),body,reset};
}
it('paired intimacy preserves all 48 bones, grounds the carrier, lifts then releases the recipient across heights and headings',()=>{
 for(const heights of [[1,1],[.8,1.25],[1.25,.8]])for(const heading of [0,Math.PI/2]){
  const a=actor(heights[0],-.38,0),b=actor(heights[1],.38,Math.PI),both=[a,b];
  const stage=new T.Group();stage.rotation.y=heading;stage.add(a.visitor.root,b.visitor.root);stage.updateMatrixWorld(true);
  const lengths=both.map(r=>r.visitor.rig!.skeleton.bones.map(b=>b.position.length()));
  const foot=(r:typeof a)=>r.visitor.rig!.bones.L_foot.getWorldPosition(new T.Vector3());
  const initial=foot(a).y;
  for(const action of ['home-hug','home-princess-carry'])for(const time of [0,1.5,3,5,7.5,9,10]){
   both.forEach(r=>r.reset());poseIntimacy(action,both,time);
   both.forEach((r,i)=>{expect(r.visitor.rig!.skeleton.bones).toHaveLength(48);expect(r.visitor.rig!.skeleton.bones.map(b=>b.position.length())).toEqual(lengths[i]);expect(r.visitor.rig!.skeleton.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite))).toBe(true);});
   expect(foot(a).y).toBeCloseTo(initial,2);
   if(action==='home-princess-carry'&&time===5)expect(foot(b).y).toBeGreaterThan(.2);
   if(time===10){expect(b.body.position.length()).toBeCloseTo(0,4);}
  }
  both.forEach(r=>{r.reset();expect(r.body.position.length()).toBe(0);r.visitor.rig!.mesh.geometry.dispose();});
 }
});
it('carrier sustains load-scaled knee and torso counterbalance until the carried person is set down',()=>{
 for(const [carrierHeight,recipientHeight] of [[1,1],[.8,1.25],[1.25,.8]]){
  const a=actor(carrierHeight,-.4,0),b=actor(recipientHeight,.4,Math.PI);
  const foot=()=>a.visitor.rig!.bones.L_foot.getWorldPosition(new T.Vector3()).y;
  a.reset();b.reset();
  const floor=foot();
  poseIntimacy('home-princess-carry',[a,b],0);
  const spineAtStart=a.visitor.rig!.bones.spine.rotation.x;
  a.reset();b.reset();
  poseIntimacy('home-princess-carry',[a,b],5);
  const spineAtHold=a.visitor.rig!.bones.spine.rotation.x;
  const thighAtHold=a.visitor.rig!.bones.L_thigh.rotation.x;
  expect(spineAtHold, `load ratio ${carrierHeight}/${recipientHeight}`).toBeLessThan(spineAtStart-.015);
  expect(thighAtHold).toBeLessThan(-.04);
  expect(Math.abs(foot()-floor)).toBeLessThan(.012);
  a.reset();b.reset();
  poseIntimacy('home-princess-carry',[a,b],10);
  expect(a.visitor.rig!.bones.spine.rotation.x).toBeCloseTo(spineAtStart,3);
  expect(b.body.position.length()).toBeLessThan(.0001);
 }
});

it('princess lift and set-down remain continuous across approach and release phase boundaries',()=>{
 for(const heights of [[1,1],[.8,1.25],[1.25,.8]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  const sample=(time:number)=>{
   a.reset();b.reset();poseIntimacy('home-princess-carry',[a,b],time);
   return [a,b].flatMap(actor=>['hips','chest','L_hand','R_hand','L_foot','R_foot'].map(n=>
    actor.visitor.rig!.bones[n].getWorldPosition(new T.Vector3())));
  };
  for(const boundary of [.5,1.7,2,2.4,3.8,6.7,7.7,8.8,9.5]){
   const before=sample(boundary-.008),after=sample(boundary+.008);
   for(let i=0;i<before.length;i++)expect(
    before[i].distanceTo(after[i]),
    `height pair ${heights} boundary ${boundary}, anchor ${i}`
   ).toBeLessThan(.12);
  }
 }
});

it('cancels an ongoing standing pair cleanly if a new observer blocks the occupied area',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>JSON.parse(readFileSync('public/'+url.replace(/^\//,''),'utf8'))})));
 try{
  const a=actor(1,-.4,0),b=actor(1,.4,Math.PI);
  let clear=true,checks=0;
  const runtime=createSocialScene([{id:'a',visitor:a.visitor},{id:'b',visitor:b.visitor}],{
   canPlace:()=>true,canPerform:()=>{checks++;return clear;},
  });
  expect(await runtime.start('home-hug','a','b')).toBe(true);
  const start=runtime.inspect().session!;
  expect(start).not.toBeNull();
  const approach=start.duration-socialActions['home-hug'].duration;
  runtime.advance(approach+1);
  expect(runtime.active).toBe(true);
  clear=false;
  runtime.advance(.30);
  expect(runtime.active).toBe(false);
  expect(runtime.inspect().session).toBeNull();
  expect(checks).toBeGreaterThan(1);
  expect(a.body.position.length()).toBe(0);
  expect(b.body.position.length()).toBe(0);
  clear=true;
  expect(await runtime.start('home-hug','a','b')).toBe(true);
  runtime.cancel();
 }finally{vi.unstubAllGlobals();}
});

it('carrier keeps both support palms near the actual recipient back and leg anchors across sizes',()=>{
 for(const heights of [[1,1],[.8,1.25],[1.25,.8]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  a.reset();b.reset();poseIntimacy('home-princess-carry',[a,b],5);
  const anchors=[
   princessCarrySupports(b.visitor).upper,
    princessCarrySupports(b.visitor).lower,
  ];
  for(const [i,side] of (['L','R'] as const).entries()){
   const palm=a.visitor.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side));
   expect(palm.distanceTo(anchors[i]),`carry hand ${side} heights ${heights}`).toBeLessThan(.12);
  }
 }
});

it('raises hands before contact, pats with one hand while the other supports, and returns smoothly when seeking',()=>{
 const both=[actor(1,-.33,0),actor(1.15,.33,Math.PI)];
 const sample=(time:number)=>{both.forEach(r=>r.reset());poseIntimacy('home-hug',both,time);return both.map(r=>Object.fromEntries(['L','R'].map(side=>[side,r.visitor.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side))])));};
 const idle=sample(0),ready=sample(.9),hold=sample(3.85),lift=sample(4.09),land=sample(4.31);
 expect(ready[0].R.y-idle[0].R.y).toBeGreaterThan(.06);
 expect(lift[0].R.distanceTo(hold[0].R)).toBeGreaterThan(.04);
 expect(lift[0].L.distanceTo(hold[0].L)).toBeLessThan(.025);
 expect(land[0].R.distanceTo(hold[0].R)).toBeLessThan(.025);
 const replay=sample(4.09);expect(replay[0].R.distanceTo(lift[0].R)).toBeLessThan(1e-8);
 for(const boundary of [1.15,2.75,3.85,4.09,4.31,6.05,7.5,8.7,9.75]){
  const before=sample(boundary-.001),after=sample(boundary+.001);
  for(let i=0;i<2;i++)for(const side of ['L','R'])expect(before[i][side].distanceTo(after[i][side])).toBeLessThan(.02);
 }
 const end=sample(10);for(let i=0;i<2;i++)for(const side of ['L','R'])expect(end[i][side].distanceTo(idle[i][side])).toBeLessThan(.001);
});
it('cancel and completion clear the carried pose for either initiator without moving navigation roots into the air',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>JSON.parse(readFileSync('public/'+url.replace(/^\//,''),'utf8'))})));
 try{
  const both=[actor(1,-.45,0),actor(1.15,.45,Math.PI)];
  const runtime=createSocialScene(both.map((r,i)=>({id:String(i),visitor:r.visitor})));
  for(const action of ['home-princess-carry','home-princess-carried'])for(const ids of [['0','1'],['1','0']]){
   await runtime.start(action,...ids as [string,string]);runtime.seek(5);
   // Both roles consume the real capture; shared arm IK still owns their hands.
   for(const r of both){
    const apply=vi.mocked(r.visitor.applySelectedFrame);
    expect(apply).toHaveBeenCalled();
    const frame=apply.mock.lastCall![0];
    expect(frame.rotations.spine).toBeDefined();
    expect(frame.rotations.L_upperArm).toBeUndefined();
    expect(frame.rotations.R_hand).toBeUndefined();
   }
   expect(both[Number(ids[action==='home-princess-carried'?0:1])].body.position.length()).toBeGreaterThan(.1);
   expect(both.map(r=>r.visitor.root.position.y)).toEqual([0,0]);
   runtime.cancel();expect(runtime.inspect().session).toBeNull();both.forEach(r=>expect(r.body.position.length()).toBe(0));
   await runtime.start(action,...ids as [string,string]);runtime.advance(100);
   expect(runtime.inspect().session).toBeNull();both.forEach(r=>expect(r.body.position.length()).toBe(0));
  }
 }finally{vi.unstubAllGlobals();}
});
it('rests curved fingers across the back, opens only the patting hand, and restores the idle fingers',()=>{
 const both=[actor(1,-.33,0),actor(1.15,.33,Math.PI)];
 const sample=(time:number)=>{both.forEach(r=>r.reset());poseIntimacy('home-hug',both,time);return both.map(r=>Object.fromEntries(Object.entries(r.visitor.rig!.bones).map(([n,b])=>[n,b.quaternion.clone()])));};
 const idle=sample(0),hold=sample(3.85);
 for(const [i,r] of both.entries())for(const side of ['L','R'] as const){
  const rig=r.visitor.rig!,sign=side==='L'?1:-1,handQ=rig.bones[side+'_hand'].getWorldQuaternion(new T.Quaternion());
  const backQ=both[1-i].visitor.rig!.bones.chest.getWorldQuaternion(new T.Quaternion());
  const palmIn=new T.Vector3(0,-1,0).applyQuaternion(handQ),backIn=new T.Vector3(0,0,1).applyQuaternion(backQ);
  expect(palmIn.dot(backIn)).toBeGreaterThan(.97);
  const fingers=new T.Vector3(sign,0,0).applyQuaternion(handQ).applyQuaternion(backQ.clone().invert());
  expect(Math.abs(fingers.x)).toBeGreaterThan(.9);expect(Math.abs(fingers.y)).toBeLessThan(.35);
  expect(hold[i][side+'_pinky_tip'].angleTo(new T.Quaternion())).toBeGreaterThan(hold[i][side+'_index_tip'].angleTo(new T.Quaternion())+.1);
  const tips=BLANK_FINGERS.filter(f=>f.name!=='thumb').map(f=>{const offset=new T.Vector3(sign*(f.tip[0]-f.start[0]),f.tip[1]-f.start[1],f.tip[2]-f.start[2]).multiplyScalar(.45*BLANK_SCALE);return rig.bones[`${side}_${f.name}_tip`].localToWorld(offset);});
  for(let j=1;j<tips.length;j++)expect(tips[j].distanceTo(tips[j-1])).toBeGreaterThan(.02);
 }
 const pat=sample(4.09);expect(pat[0].R_middle_tip.angleTo(new T.Quaternion())).toBeLessThan(hold[0].R_middle_tip.angleTo(new T.Quaternion())-.05);
 expect(pat[0].L_middle_tip.angleTo(hold[0].L_middle_tip)).toBeLessThan(.001);
 const end=sample(10);for(let i=0;i<2;i++)for(const side of ['L','R'])for(const finger of BLANK_FINGERS)for(const suffix of ['', '_tip']){
  const name=`${side}_${finger.name}${suffix}`;expect(end[i][name].angleTo(idle[i][name])).toBeLessThan(1e-6);
 }
});

it('kneels in front of the seated hug partner, preserves their seat, strokes the head and releases',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>JSON.parse(readFileSync('public/'+url.replace(/^\//,''),'utf8'))})));
 try{for(const heights of [[1,1],[.8,1.25],[1.25,.8]])for(const seatedFirst of [false,true]){
  const a=actor(heights[0],1,Math.PI),b=actor(heights[1],0,0);b.visitor.root.position.y=.95;
  const pose={kind:'seat',hands:[],seatHeight:.95/b.visitor.root.scale.y};
  const reset=()=>{a.reset();b.visitor.animate(0,'idle','seated',pose);b.visitor.root.updateWorldMatrix(true,true);};
  reset();const hip=b.visitor.rig!.bones.hips.getWorldPosition(new T.Vector3()),thigh=b.visitor.rig!.bones.L_thigh.quaternion.clone(),floor=Math.min(...['L_foot','R_foot','L_toe','R_toe'].map(n=>a.visitor.rig!.bones[n].getWorldPosition(new T.Vector3()).y));
  const both=seatedFirst?[b,a]:[a,b],sample=(time:number)=>{reset();poseIntimacy('home-hug',both,time,seatedFirst?0:1);};
  for(const time of [0,.5,1,2,3,4.5,6,8,9,10]){
   sample(time);expect(b.visitor.rig!.bones.hips.getWorldPosition(new T.Vector3()).distanceTo(hip)).toBeLessThan(.0001);expect(b.visitor.rig!.bones.L_thigh.quaternion.angleTo(thigh)).toBeLessThan(.0001);
   for(const n of ['L_shin','R_shin','L_foot','R_foot','L_toe','R_toe'])expect(a.visitor.rig!.bones[n].getWorldPosition(new T.Vector3()).y).toBeGreaterThanOrEqual(floor-.001);
   if(time>=3&&time<=6){const hands=both.flatMap(r=>['L','R'].map(side=>r.visitor.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side))));for(let i=0;i<hands.length;i++)for(let j=i+1;j<hands.length;j++)expect(hands[i].distanceTo(hands[j]),`seated hug palms ${i}/${j}, heights ${heights}, time ${time}`).toBeGreaterThan(.25);}
   if(time===4.5){expect(a.visitor.rig!.bones.L_shin.getWorldPosition(new T.Vector3()).y-floor).toBeLessThan(.11);expect(a.visitor.rig!.bones.head.rotation.y).toBeGreaterThan(.5);}
  }
  sample(4.5);const hand=b.visitor.rig!.bones.L_hand.localToWorld(furniturePalm('L'));sample(5.1);expect(b.visitor.rig!.bones.L_hand.localToWorld(furniturePalm('L')).distanceTo(hand)).toBeGreaterThan(.008);
  const runtime=createSocialScene([{id:'a',visitor:a.visitor},{id:'b',visitor:b.visitor}],{pinned:{id:'b',pose}});
  await runtime.start('home-hug',seatedFirst?'b':'a',seatedFirst?'a':'b');runtime.seek(5);runtime.cancel();expect(b.visitor.root.position.y).toBe(.95);expect(b.visitor.rig!.bones.L_thigh.quaternion.angleTo(thigh)).toBeLessThan(.0001);expect(a.body.position.length()).toBe(0);
  both.forEach(r=>r.visitor.rig!.mesh.geometry.dispose());
 }}finally{vi.unstubAllGlobals();}
});


it('combines actual princess-carry clip bones with existing paired hand support for both role directions',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>JSON.parse(readFileSync('public/'+url.replace(/^\//,''),'utf8'))})));
 try{
  for(const action of ['home-princess-carry','home-princess-carried'])for(const heights of [[1,1],[.8,1.25]]){
   const residents=[actor(heights[0],-.45,0),actor(heights[1],.45,Math.PI)];
   residents.forEach(r=>{
    vi.mocked(r.visitor.applySelectedFrame).mockImplementation((frame:MotionFrame,weight=1)=>{
     for(const [n,q] of Object.entries(frame.rotations))r.visitor.rig!.bones[n]?.quaternion.slerp(q as T.Quaternion,weight);
     r.visitor.root.updateWorldMatrix(true,true);
    });
   });
   const runtime=createSocialScene(residents.map((r,i)=>({id:String(i),visitor:r.visitor})));
   expect(await runtime.start(action,'0','1')).toBe(true);
   const session=runtime.inspect().session!;
   runtime.seek(session.duration-socialActions[action].duration+5.6);
   const [carrier,recipient]=action==='home-princess-carried'?[residents[1],residents[0]]:residents;
   expect(recipient.body.position.length(),action).toBeGreaterThan(.10);
   expect(residents.map(r=>r.visitor.root.position.y)).toEqual([0,0]);
   for(const r of residents){
    const calls=vi.mocked(r.visitor.applySelectedFrame).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const frame=calls.at(-1)![0];
    expect(frame.rotations.spine).toBeDefined();
    expect(frame.rotations.L_upperArm).toBeUndefined(); // Existing hand IK still owns both supports.
    expect(frame.position.y).toBe(0); // Navigation never inherits Meshy vertical drift.
    expect(r.visitor.rig!.skeleton.bones.every((bone:T.Bone)=>bone.matrixWorld.elements.every(Number.isFinite))).toBe(true);
   }
   const supports=[
    princessCarrySupports(recipient.visitor).upper,
     princessCarrySupports(recipient.visitor).lower,
   ];
   for(const [i,side] of (['L','R'] as const).entries()){
    const palm=carrier.visitor.rig!.bones[side+'_hand'].localToWorld(furniturePalm(side));
    expect(palm.distanceTo(supports[i]),`real capture hand ${side}, ${action}, ${heights}`).toBeLessThan(.20);
   }
   runtime.cancel();
   expect(runtime.inspect().session).toBeNull();
   residents.forEach(r=>{expect(r.body.position.length()).toBeLessThan(1e-5);r.visitor.rig!.mesh.geometry.dispose();});
  }
 }finally{vi.unstubAllGlobals();}
});


it('reclines a taller carried partner farther without moving navigation roots or stretching bones',()=>{
 const sample=(carrier:number,recipient:number)=>{
  const a=actor(carrier,-.4,0),b=actor(recipient,.4,Math.PI);
  const lengths=b.visitor.rig!.skeleton.bones.map((n:T.Bone)=>n.position.length());
  a.reset();b.reset();poseIntimacy('home-princess-carry',[a,b],5);
  const angle=new T.Euler().setFromQuaternion(b.visitor.rig!.bones.hips.quaternion,'YXZ').x;
  const startRoots=[a.visitor.root.position.y,b.visitor.root.position.y];
  expect(startRoots).toEqual([0,0]);
  expect(b.visitor.rig!.skeleton.bones.map((n:T.Bone)=>n.position.length())).toEqual(lengths);
  return Math.abs(angle);
 };
 const equal=sample(1,1),tallRecipient=sample(.8,1.25),shortRecipient=sample(1.25,.8);
 expect(tallRecipient).toBeGreaterThan(equal+.10);
 expect(tallRecipient).toBeGreaterThan(shortRecipient+.10);
});

it('acquires hands, offers one knee, then lifts after the planted-foot phase',()=>{
 const f=princessCarryPhase;
 expect(f(1.5).lift).toBe(0);
 expect(f(3.6).secured).toBeGreaterThan(.99);
 expect(f(2.8).lift).toBe(0);
 expect(f(3.5).offer).toBeGreaterThan(.98);
 expect(f(3.5).seat).toBe(0);
 expect(f(3.5).lift).toBe(0);
 expect(f(3.86).kneeReach).toBeGreaterThan(.99);
 expect(f(3.86).lift).toBe(0);
 expect(f(3.5).cradle).toBe(0);
 expect(f(5.5).lift).toBeGreaterThan(.99);
 expect(f(8.8).plant).toBeGreaterThan(0);
 expect(f(8.8).release).toBe(0);
 expect(f(9.5).release).toBeGreaterThan(0);
 for(const heights of [[1,1],[.8,1.25],[1.25,.8]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  expect(assessPrincessCarryReach(a.visitor,b.visitor).possible).toBe(true);
  for(const time of [0,1.5,2.8,3.5,4.5,5,6.9,7.8,8.7,9.5,10]){
   a.reset();b.reset();poseIntimacy('home-princess-carry',[a,b],time);
   expect([a,b].every(r=>r.visitor.rig!.skeleton.bones.every((n:T.Bone)=>n.matrixWorld.elements.every(Number.isFinite)))).toBe(true);
  }
 }
});

it('one-knee offer stays upright before separate seating and lifting phases',()=>{
 const p=(t:number)=>princessCarryPhase(t);
 expect(p(3.45).offer).toBeGreaterThan(.9);
 expect(p(3.45).seat).toBe(0);
 expect(p(3.45).lift).toBe(0);
 expect(p(3.45).cradle).toBe(0);
 expect(p(4.35).seat).toBeGreaterThan(0);
 expect(p(4.35).seat).toBeLessThan(.5);
 expect(p(4.35).lift).toBeGreaterThan(0);
 expect(p(4.35).lift).toBeLessThan(.5);
 for(const heights of [[1,1],[.8,1.25],[1.25,.8]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  const sample=(t:number)=>{
   a.reset();b.reset();
   poseIntimacy('home-princess-carry',[a,b],t);
   return {hip:b.visitor.rig!.bones.hips.getWorldPosition(new T.Vector3()),
    chest:b.visitor.rig!.bones.chest.getWorldPosition(new T.Vector3()),
    foot:b.visitor.rig!.bones.L_toe.getWorldPosition(new T.Vector3())};
  };
  const entering=sample(3.45),held=sample(5.5);
  expect(entering.chest.y-entering.hip.y, `recipient should be upright while offering a knee ${heights}`).toBeGreaterThan(.28);
  expect(held.foot.y-entering.foot.y,`recipient should actually rise after support ${heights}`).toBeGreaterThan(.15);
 }
});

it('during the offer only the recipient raised thigh bends, while carrier stays upright',()=>{
 for(const heights of [[1,1],[1.25,.8],[.8,1.25]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  a.reset();b.reset();poseIntimacy('home-princess-carry',[a,b],3.45);
  const offered=b.visitor.rig!.bones.L_thigh.quaternion;
  const planted=b.visitor.rig!.bones.R_thigh.quaternion;
  expect(offered.angleTo(planted),`independent leg offer for ${heights}`).toBeGreaterThan(.60);
  expect(planted.angleTo(new T.Quaternion()),`standing recipient leg should not crouch ${heights}`).toBeLessThan(.25);
  const carrierShin=a.visitor.rig!.bones.L_shin.quaternion;
  expect(carrierShin.angleTo(new T.Quaternion()),`carrier should not deep squat while receiving ${heights}`).toBeLessThan(.30);
 }
});

it('carry elbow bend directions do not reverse between nearby animation frames',()=>{
 for(const heights of [[1,1],[.8,1.25],[1.25,.8]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  const prev=new Map<string,T.Vector3>();
  for(let step=0;step<=28;step++){
   const time=2.8+step*.10;
   a.reset();b.reset();
   poseIntimacy('home-princess-carry',[a,b],time);
   for(const [index,r] of [a,b].entries())for(const side of ['L','R'] as const){
    const bones=r.visitor.rig!.bones;
    const shoulder=bones[side+'_upperArm'].getWorldPosition(new T.Vector3());
    const elbow=bones[side+'_forearm'].getWorldPosition(new T.Vector3());
    const wrist=bones[side+'_hand'].getWorldPosition(new T.Vector3());
    const axis=wrist.clone().sub(shoulder);
    if(axis.lengthSq()<1e-7)continue;
    axis.normalize();
    const bend=elbow.sub(shoulder);
    bend.addScaledVector(axis,-bend.dot(axis));
    if(bend.lengthSq()<1e-6)continue;
    bend.normalize();
    const key=index+side,before=prev.get(key);
    if(before)expect(bend.dot(before),`elbow flip height ${heights} role ${index} side ${side} time ${time}`).toBeGreaterThan(-.65);
    prev.set(key,bend);
   }
  }
 }
});

it('carry hands have staggered entry and a complete fade back to idle after grounding',()=>{
 const f=princessCarryPhase;
 expect(f(0).backReach).toBe(0);
 expect(f(0).kneeReach).toBe(0);
 expect(f(2.45).backReach).toBeGreaterThan(.95);
 expect(f(2.45).kneeReach).toBe(0);
 expect(f(3.45).kneeReach).toBeGreaterThan(0);
 expect(f(3.45).shoulderL).toBeGreaterThan(f(3.45).shoulderR);
 expect(f(5.3).backReach).toBeGreaterThan(.99);
 expect(f(5.3).kneeReach).toBeGreaterThan(.99);
 for(const time of [9.6,9.8,10]){
  expect(f(time).backReach).toBe(0);
  expect(f(time).kneeReach).toBe(0);
  expect(f(time).shoulderL).toBe(0);
  expect(f(time).shoulderR).toBe(0);
 }
 for(const heights of [[1,1],[1.25,.8],[.8,1.25]]){
  const a=actor(heights[0],-.4,0),b=actor(heights[1],.4,Math.PI);
  const handPose=(time:number)=>{
   a.reset();b.reset();poseIntimacy('home-princess-carry',[a,b],time);
   return [a,b].map(r=>['L','R'].map(side=>
    r.visitor.rig!.bones[side+'_upperArm'].quaternion.clone()));
  };
  const idle=handPose(0),end=handPose(10);
  for(let i=0;i<2;i++)for(let j=0;j<2;j++)
   expect(idle[i][j].angleTo(end[i][j]),`returned arms ${heights} ${i} ${j}`).toBeLessThan(.03);
 }
});
