import {Matrix4,Quaternion,Vector3,type Bone} from 'three';

/** Retargeted, rotation-only walking cycles. Source/credits live with the fixture. */
export interface RoomWalkClip {sourceName:string;duration:number;times:number[];tracks:Record<string,number[]>}
export function createRoomWalkSampler(clip:RoomWalkClip){
 const samples=Object.entries(clip.tracks),q=new Quaternion();
 return (time:number,pose:Record<string,Quaternion>)=>{
  const t=((time%clip.duration)+clip.duration)%clip.duration;
  let i=0;while(i<clip.times.length-2&&clip.times[i+1]<=t)i++;
  const j=Math.min(i+1,clip.times.length-1),mix=(t-clip.times[i])/(clip.times[j]-clip.times[i]||1);
  for(const [name,values]of samples){const target=pose[name];if(target)target.fromArray(values,i*4).normalize().slerp(q.fromArray(values,j*4).normalize(),mix);}
 };
}

/** Estimate room travel from the retargeted stride, never source avatar scale. */
export function roomWalkSpeed(clip:RoomWalkClip,bones:Record<string,Bone>){
 const sample=createRoomWalkSampler(clip),pose=Object.fromEntries(Object.keys(bones).map(n=>[n,new Quaternion()]));
 const worlds=Object.fromEntries(Object.keys(bones).map(n=>[n,new Matrix4()])),unit=new Vector3(1,1,1),local=new Matrix4();
 const range={L:[Infinity,-Infinity],R:[Infinity,-Infinity]};
 for(const t of clip.times){
  sample(t,pose);
  for(const [name,bone]of Object.entries(bones)){
   local.compose(bone.position,pose[name],unit);const parent=bone.parent&&worlds[bone.parent.name];
   if(parent)worlds[name].multiplyMatrices(parent,local);else worlds[name].copy(local);
  }
  for(const side of ['L','R']as const){const z=worlds[`${side}_foot`].elements[14];range[side][0]=Math.min(range[side][0],z);range[side][1]=Math.max(range[side][1],z);}
 }
 return ((range.L[1]-range.L[0])+(range.R[1]-range.R[0]))/clip.duration;
}

/**
 * Drive a retargeted walk clip from actual horizontal travel, not wall-clock
 * seconds. Pass the actor's WORLD position: room navigation moves the parent
 * group while paired social navigation can move the visitor root itself.
 *
 * A stopped actor holds its phase. Large teleports and timeline jumps do not
 * fake a burst of footsteps. This controls gait timing only: it is not foot IK.
 */
export function createDistanceWalkClock(){
 const previous=new Vector3();
 let previousTime:number|null=null,phase=0;
 const reset=()=>{previousTime=null;phase=0;};
 return {reset,sample(world:Vector3,time:number,speed:number,walking=true){
  if(!walking||!Number.isFinite(time)||!Number.isFinite(speed)||speed<=0||
     !Number.isFinite(world.x)||!Number.isFinite(world.z)){reset();return 0;}
  if(previousTime===null){previous.copy(world);previousTime=time;return phase;}
  const dt=time-previousTime,distance=Math.hypot(world.x-previous.x,world.z-previous.z);
  if(dt<0)phase=0;
  else if(dt>0&&dt<=1&&distance<=Math.max(.08,speed*dt*2.5))phase+=distance/speed;
  previous.copy(world);previousTime=time;
  return phase;
 }};
}
