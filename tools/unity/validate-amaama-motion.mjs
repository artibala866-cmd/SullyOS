#!/usr/bin/env node
// Offline structure/rotation validation for Unity-exported SullyOS clips.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const required=['hips','spine','head','L_upperArm','R_upperArm',
  'L_forearm','R_forearm','L_hand','R_hand','L_thigh','R_thigh','L_shin','R_shin'];
const isFiniteNum=n=>typeof n==='number'&&Number.isFinite(n);
const validArray=(v,n,name)=>{
  if(!Array.isArray(v)||v.length!==n||!v.every(isFiniteNum))
    throw Error(name+': expected '+n+' finite numbers');
};
const fail=(condition,message)=>{if(!condition)throw Error(message)};
const quaternionDistance=(track,i)=>{
  const a=track.slice((i-1)*4,i*4),b=track.slice(i*4,(i+1)*4);
  const dot=Math.min(1,Math.abs(a.reduce((s,x,k)=>s+x*b[k],0)));
  return 2*Math.acos(dot);
};

export function validateMotion(clip,expectedId){
  fail(clip&&clip.version===1,'Unsupported SelectedClip version');
  fail(typeof clip.id==='string'&&/^[a-z0-9][a-z0-9-]*$/.test(clip.id),'Bad motion ID');
  if(expectedId)fail(clip.id===expectedId,'Motion ID does not match '+expectedId);
  fail(isFiniteNum(clip.duration)&&clip.duration>0&&clip.duration<=120,'Bad clip duration');
  fail(Array.isArray(clip.actors)&&clip.actors.length===2,'Exactly two actors required');
  const notes=[],perActor=[];
  for(let a=0;a<2;a++){
    const p=clip.actors[a],n=p?.times?.length;
    fail(isFiniteNum(p?.duration)&&Math.abs(p.duration-clip.duration)<.002,'Actor '+a+': duration mismatch');
    fail(Number.isInteger(n)&&n>=2&&n<=7201,'Actor '+a+': invalid frame count');
    validArray(p.times,n,'actor '+a+' times');
    fail(Math.abs(p.times[0])<.002&&Math.abs(p.times[n-1]-clip.duration)<.002,
      'Actor '+a+': time range must be [0,duration]');
    for(let i=1;i<n;i++)fail(p.times[i]>p.times[i-1],'Actor '+a+': non-increasing time '+i);
    validArray(p.positions,n*3,'actor '+a+' positions');
    fail(p.tracks&&typeof p.tracks==='object'&&!Array.isArray(p.tracks),'Actor '+a+': missing tracks');
    fail(p.tracks.hips,'Actor '+a+': missing hips quaternion');
    fail(p.points&&typeof p.points==='object'&&!Array.isArray(p.points),'Actor '+a+': missing points record');
    fail(isFiniteNum(p.hipHeight),'Actor '+a+': missing hipHeight');
    let motion=0,maxStep=0;
    for(const [name,track] of Object.entries(p.tracks)){
      fail(/^[a-zA-Z0-9_]+$/.test(name),'Actor '+a+': invalid bone name '+name);
      validArray(track,n*4,'Actor '+a+' '+name);
      for(let i=0;i<n;i++){
        const q=track.slice(i*4,(i+1)*4);
        const norm=Math.hypot(...q);
        fail(Math.abs(norm-1)<.03,'Actor '+a+' '+name+': nonunit quaternion at '+i);
        if(i){
          const angle=quaternionDistance(track,i),dt=p.times[i]-p.times[i-1];
          fail(angle<1.6,'Actor '+a+' '+name+': large rotation snap '+angle.toFixed(2)+'rad at '+i);
          if(angle>.45)notes.push('Actor '+a+' '+name+': check '+(angle*180/Math.PI).toFixed(0)+' degrees at '+p.times[i].toFixed(2)+'s');
          if(dt>.15)notes.push('Actor '+a+': wide sample gap at '+i);
          maxStep=Math.max(maxStep,angle);
          motion+=angle;
        }
      }
    }
    for(const [name,point] of Object.entries(p.points))validArray(point,n*3,'Actor '+a+' point '+name);
    perActor.push({actor:a,frames:n,bones:Object.keys(p.tracks).length,motion:Math.round(motion*100)/100,maxStepDegrees:Math.round(maxStep*180/Math.PI)});
  }
  const active=perActor.find(a=>a.bones>1);
  fail(active,'Both actors contain only idle hips: no baked motion');
  for(const b of required)fail(b in clip.actors[active.actor].tracks,'Missing essential bone '+b);
  fail(active.motion>.3,'Baked motion is effectively static');
  fail(perActor[1-active.actor].bones===1,'Non-performing actor must stay neutral in this export');
  return {id:clip.id,duration:clip.duration,activeActor:active.actor,actors:perActor,warnings:[...new Set(notes)].slice(0,20)};
}
function selftest(){
  const times=[0,.1,.2,.3],identity=[0,0,0,1],animated=[0,0,0,1,.02,0,0,.99979998,.12,0,0,.9927739,.2,0,0,.9797959];
  const actor=(active)=>({duration:.3,times,positions:times.flatMap(()=>[0,1,active?-.36:.36]),
    tracks:active?Object.fromEntries(required.map(n=>[n,animated])):{hips:times.flatMap(()=>identity)},
    points:{},hipHeight:1});
  const good={version:1,id:'home-head-pat',duration:.3,actors:[actor(true),actor(false)]};
  assert.equal(validateMotion(good).activeActor,0);
  const wrong=structuredClone(good);wrong.actors[0].tracks.head[0]=99;
  assert.throws(()=>validateMotion(wrong),/nonunit quaternion/);
  const jump=structuredClone(good);jump.actors[0].tracks.head.splice(4,4,1,0,0,0);
  assert.throws(()=>validateMotion(jump),/rotation snap/);
  const empty=structuredClone(good);delete empty.actors[0].tracks.head;
  assert.throws(()=>validateMotion(empty),/essential bone/);
  console.log('4 validator self-tests passed');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  if(process.argv[2]==='--selftest')selftest();
  else {
    if(!process.argv[2])throw Error('Provide exported .json path (or --selftest)');
    const report=validateMotion(JSON.parse(readFileSync(process.argv[2],'utf8')),process.argv[3]);
    console.log(JSON.stringify(report,null,2));
    console.log('JSON structure valid. No visual/body/contact/permission QA implied.');
  }
}
