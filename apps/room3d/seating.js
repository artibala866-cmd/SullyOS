import {usableFurniturePoints} from './furniturePointRegistry.js';

// Reviewed body-2 poses. Keep them separate from the generated asset catalog;
// low height alone does not make a stool suitable for a floor-rest pose.
const body2SeatProfiles={bedroom_ref_flower_pouf:{pose:'floor',forward:.20}};
// Reviewed mattress surface, not the wider draped blanket/bed-frame bounds.
const body2BedProfiles={
 show_bed:{headEnd:-1.27,edgeX:1.30,edgeY:.85,
  // Reviewed mattress at both sleeping lanes; the duvet slopes down by the footboard.
  footSurface:[[.6,.887],[.8,.900],[1,.898],[1.2,.882],[1.4,.788],[1.6,.627]]},
 bedroom_single_bed:{headEnd:-1.38,edgeX:.82,edgeY:1.10},
 bedroom_double_bed:{headEnd:-1.55,edgeX:1.48,edgeY:1.08},
 // Keep the existing direct entry for raised/railed beds; no invented ladder animation.
 bedroom_bunk:{headEnd:-1.65,entry:false},
 bedroom_loft:{headEnd:-1.45,entry:false},
};
// Seat coordinates are in the normalized furniture's local frame: +Y up, +Z front.
export function seatTransform(room,catalog,selection,body2=false){
 if(!selection||selection.roomId!==room.id)return null;
 const item=room.items.find(i=>i.id===selection.itemId&&!i.stored);
 const a=catalog.find(a=>a.id===item?.assetId);
 const seat=usableFurniturePoints(a,selection.bed?'beds':'seats').find(s=>s.id===selection.seatId);
 if(!item||!seat||!selection.bed&&seatBlockedBySupportedProp(room,catalog,item,seat))return null;
 const angle=item.rotation*Math.PI/180,[x,y,z]=seat.position,rotation=angle+(seat.rotation??0)*Math.PI/180;
 const bedPlacement=selection.bed&&a.id==='show_bed'?{across:.70,forward:.35}:null;
 const profile=body2&&!selection.bed?body2SeatProfiles[a.id]:null,forward=bedPlacement?.forward??(selection.dining&&a.id==='show_kitchen_bench'?.15:profile?.forward??0);
 const bedProfile=selection.bed?body2BedProfiles[a.id]:null;
 const localAngle=(seat.rotation??0)*Math.PI/180,along=x*Math.sin(localAngle)+z*Math.cos(localAngle),across=x*Math.cos(localAngle)-z*Math.sin(localAngle);
 const inward=bedPlacement?(Math.sign(across)||1)*bedPlacement.across-across:0;
 return {position:[item.x+x*Math.cos(angle)+z*Math.sin(angle)+Math.sin(rotation)*forward+Math.cos(rotation)*inward,item.y+y,item.z-x*Math.sin(angle)+z*Math.cos(angle)+Math.cos(rotation)*forward-Math.sin(rotation)*inward],rotation,pose:selection.bed?'bed':profile?.pose??'chair',height:item.y+y-.18,...bedProfile?{bed:{...bedProfile,anchorZ:along+forward,center:[item.x,item.y,item.z],halfWidth:(Math.abs(Math.cos(localAngle))*a.size[0]+Math.abs(Math.sin(localAngle))*a.size[2])/2,side:Math.sign(across)||1,itemRotation:rotation}}:{}};
}
export function roomBeds(room,catalog){
 return room.items.filter(i=>!i.stored).flatMap(item=>{
  const a=catalog.find(a=>a.id===item.assetId);
  return usableFurniturePoints(a,'beds').map(b=>({roomId:room.id,itemId:item.id,seatId:b.id,bed:true,label:a.name+' · '+b.label}));
 });
}
// An object supported ON a seat's top surface can physically occupy its pelvis
// and thigh area. Check furniture-local footprints, including prop rotation.
function seatBlockedBySupportedProp(room,catalog,parent,seat){
 const angle=parent.rotation*Math.PI/180,c=Math.cos(angle),sn=Math.sin(angle);
 return room.items.some(item=>{
  if(item.stored||item.supportId!==parent.id)return false;
  const child=catalog.find(a=>a.id===item.assetId);
  if(!child||item.y<parent.y+seat.position[1]-.04)return false;
  const dx=item.x-parent.x,dz=item.z-parent.z,x=c*dx-sn*dz,z=sn*dx+c*dz,
   turn=(item.rotation-parent.rotation)*Math.PI/180,
   hx=(Math.abs(Math.cos(turn))*child.size[0]+Math.abs(Math.sin(turn))*child.size[2])/2,
   hz=(Math.abs(Math.sin(turn))*child.size[0]+Math.abs(Math.cos(turn))*child.size[2])/2;
  // Torso/hips need some extra lateral clearance beyond the authored anchor.
  return Math.abs(x-seat.position[0])<hx+.32&&Math.abs(z-seat.position[2])<hz+.20;
 });
}
export function roomSeats(room,catalog){
 return room.items.filter(i=>!i.stored).flatMap(item=>{
  const asset=catalog.find(a=>a.id===item.assetId);
  return usableFurniturePoints(asset,'seats').filter(seat=>!seatBlockedBySupportedProp(room,catalog,item,seat)).map(seat=>({roomId:room.id,itemId:item.id,seatId:seat.id,label:asset.name+(asset.seats.length>1?' · '+seat.label:'')}));
 });
}
