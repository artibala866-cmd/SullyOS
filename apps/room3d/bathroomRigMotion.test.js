import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {createBlankBody,BLANK_SCALE} from './chibi/blankBody.ts';
import {bindBlankBody} from './chibi/blankRig.ts';
import {createBlankMotion} from './chibi/blankMotion.ts';
import {createBathroomJourney,bathroomJourneyFrame,bathroomHandTargets} from './bathroomJourney.js';

// Numeric skeletal/controller verification only. It never certifies GLB
// penetration, floor contact or real browser visual quality.
function actor(height=1){
 const resident=new T.Group(),parent=new T.Group(),body=new T.Group(),hair=new T.Group();
 const mesh=new T.Mesh(createBlankBody('skin',{bodyHeight:height}),new T.MeshBasicMaterial());
 resident.add(parent);parent.scale.setScalar(2.8/BLANK_SCALE);parent.add(body);body.add(mesh,hair);
 const rig=bindBlankBody(mesh,hair,true),animate=createBlankMotion(rig,body);
 return {resident,parent,body,rig,animate};
}
function frame(a,activity,journey,t){
 const f=bathroomJourneyFrame(journey,t);
 a.resident.position.fromArray(f.position);a.resident.rotation.y=f.rotation;
 a.animate(f.time,'bath-soak','seated',{
  kind:'bath-soak',hands:[],bathHands:bathroomHandTargets(activity,f),
  bathPhase:f.phase,seatWeight:f.seatWeight,bathLegLift:f.legLift,
  bathSupport:f.support,bathCrouch:f.crouch,bathApproachStep:f.approachStep,bathApproachTrailStep:f.approachTrailStep,bathSupportFoot:f.supportFoot,bathLeadStep:f.leadStep,bathTrailStep:f.trailStep,bathLeadTuck:f.leadTuck,bathTrailTuck:f.trailTuck,
  bathLean:f.lean,handScale:1/a.parent.scale.y
 });
 a.resident.updateWorldMatrix(true,true);
 return f;
}

describe('existing skeletal bath IK and reversible tub pose',()=>{
 it('keeps every bone length and matrix finite for three heights and four rotations',()=>{
  for(const height of [.8,1,1.25])for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
   const a=actor(height),activity={kind:'bath-soak',position:[0,.54,0],rotation:yaw,
    edge:[0,1.17,.65],edgeRotation:yaw,posture:'seated',duration:8,
    bathHandWorld:[[-.25,1.16,.5],[.25,1.16,.5]]};
   const journey=createBathroomJourney(activity,[0,.18,1.35],yaw);
   const lengths=a.rig.skeleton.bones.map(b=>b.position.length());
   for(const t of [0,.45,.92,1.42,1.95,2.43,3.1,3.6,4.1,11.6,12.4,13.2,14.9,15.2]){
    const f=frame(a,activity,journey,t);
    expect(a.rig.skeleton.bones.map(b=>b.position.length())).toEqual(lengths);
    expect(a.rig.skeleton.bones.every(b=>b.matrixWorld.elements.every(Number.isFinite))).toBe(true);
    expect(a.resident.position.toArray()).toEqual(f.position);
    expect(Number.isFinite(a.body.position.y)).toBe(true);
   }
   a.animate(0,'idle','standing');
   expect(a.body.position.y).toBeCloseTo(0,6);
  }
 });
 it('moves the lead and trail thigh separately rather than shifting only the root',()=>{
  const a=actor(),activity={kind:'bath-soak',position:[0,.54,0],rotation:0,
   edge:[0,1.17,.65],edgeRotation:0,posture:'seated',duration:8,
   bathHandWorld:[[-.25,1.16,.5],[.25,1.16,.5]]};
  const j=createBathroomJourney(activity,[0,.18,1.35],0);
  frame(a,activity,j,1.82);
  expect(a.body.position.y).toBeLessThan(-.25); // A tall rig must crouch toward the real rim.
  const lead=frame(a,activity,j,2.20);
  const left=a.rig.bones.L_thigh.quaternion.clone(),right=a.rig.bones.R_thigh.quaternion.clone();
  expect(lead.leadStep).toBeGreaterThan(.5);
  expect(lead.trailStep).toBe(0);
  expect(left.angleTo(right)).toBeGreaterThan(.10);
  const trail=frame(a,activity,j,3.11);
  expect(trail.trailStep).toBeGreaterThan(.5);
  expect(trail.leadStep).toBeGreaterThan(.5); // The first foot stays clear while the second swings.
  expect(a.rig.bones.L_thigh.quaternion.angleTo(a.rig.bones.R_thigh.quaternion)).toBeGreaterThan(.10);
 });
 it('takes a real forward approach step instead of swinging back onto the same footprint',()=>{
  const a=actor(),activity={kind:'bath-soak',position:[0,.54,0],rotation:0,edge:[0,1.17,.65],edgeRotation:0,posture:'seated',duration:8,bathHandWorld:[[-.25,1.16,.5],[.25,1.16,.5]]};
  const journey=createBathroomJourney(activity,[0,.18,1.35],0);
  frame(a,activity,journey,.42);
  const first=a.rig.bones.L_toe.getWorldPosition(new T.Vector3()).clone();
  frame(a,activity,journey,1.17);
  const landed=a.rig.bones.L_toe.getWorldPosition(new T.Vector3());
  expect(first.distanceTo(landed)).toBeGreaterThan(.08);
 });
 it('preserves the exact reached pose at a mid-crossing cancellation',()=>{
  const activity={kind:'bath-soak',position:[0,.54,0],rotation:0,
   edge:[0,1.17,.65],edgeRotation:0,posture:'seated',duration:8,
   bathHandWorld:[[-.25,1.16,.5],[.25,1.16,.5]]};
  const j=createBathroomJourney(activity,[0,.18,1.35],0),a=actor();
  const before=frame(a,activity,j,2.2),angles=['L_thigh','R_thigh','spine'].map(n=>a.rig.bones[n].quaternion.clone());
  j.cancelElapsed=2.2;
  const after=frame(a,activity,j,2.2);
  expect(after.position).toEqual(before.position);
  angles.forEach((q,i)=>expect(q.angleTo(a.rig.bones[['L_thigh','R_thigh','spine'][i]].quaternion)).toBeLessThan(.001));
  const done=frame(a,activity,j,4.4);
  expect(done.done).toBe(true);
  expect(done.position).toEqual(j.front);
 });
});
