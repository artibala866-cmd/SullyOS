import {seatChangeFrame,seatChangeDuration} from './chibi/roomMotionFrame.ts';
import {bedChangePose} from './bedMotion.js';

// The last short movement into a seat is outside ordinary walking clearance.
// Its standing endpoint must still be on free floor, facing the seat's front.
// Candidate access points belong to a seat POSE, never to an asset ID.
// Front is the normal route. A workstation may block that direction, so
// supported chair actions can approach from either flank instead.
export function seatEntryCandidates(transform,{allowSides=false,sideFirst=false,allowFront=true}={}){
 if(!transform?.position||!Number.isFinite(transform.rotation))return [];
 const [x,,z]=transform.position,angle=transform.rotation,points=[];
 if(allowFront)for(let d=.45;d<=1.25+.001;d+=.05){
  points.push([x+Math.sin(angle)*d,.18,z+Math.cos(angle)*d]);
 }
 const frontCount=points.length;
 if(allowSides)for(const side of [-1,1])for(const diagonal of [0,.20])for(const distance of [.9,1.1,1.3,1.5,1.8,2]){
  const a=angle+side*Math.PI*(.5+diagonal);
  points.push([x+Math.sin(a)*distance,.18,z+Math.cos(a)*distance]);
 }
 return allowSides&&sideFirst?[...points.slice(frontCount),...points.slice(0,frontCount)]:points;
}
export function seatEntry(transform,map,offset=[0,0],{allowSides=false,sideFirst=false,preferred=null}={}){
 const valid=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&map.free(p[0]+offset[0],p[2]+offset[1]);
 if(preferred&&valid(preferred))return [...preferred];
 return seatEntryCandidates(transform,{allowSides,sideFirst}).find(valid)??null;
}
export function seatChangePose(change,time){
 if(change.pose==='bed')return bedChangePose(change,time);
 // Face the seat's forward direction before lowering onto it. Use the shortest
 // yaw arc so a turn across -PI/PI never spins all the way around.
 const duration=seatChangeDuration(change.pose),turnTime=Math.min(.3,duration*.3);
 const turn=Math.max(0,Math.min(1,time/turnTime)),blend=turn*turn*(3-2*turn);
 const target=change.rotation??0,start=change.startRotation??target;
 const delta=Math.atan2(Math.sin(target-start),Math.cos(target-start));
 const rotation=change.rising?target:start+delta*blend;
 const poseTime=change.rising?time:Math.max(0,time-turnTime)*duration/(duration-turnTime);
 const f=seatChangeFrame(poseTime,change.rising,change.pose);
 return {...f,rotation,position:change.front.map((v,i)=>v+(change.seat[i]-v)*(i===1?f.weight:(f.travel??f.weight)))};
}
