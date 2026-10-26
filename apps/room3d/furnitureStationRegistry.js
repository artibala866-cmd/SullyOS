import {roomSeats,roomBeds} from './seating.js';

// All existing activity controllers keep their own IK/path solver.
// This common gate guarantees that their advertised station contracts refer
// to real, currently placed objects and finite local-space contact targets.
const finiteVector=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
// An accepted route is no longer valid if the contact anchor moves or turns.
export function sameStationPose(a,b,positionTolerance=.04,rotationTolerance=.02){
 if(!a||!b||!finiteVector(a.position)||!finiteVector(b.position)||!Number.isFinite(a.rotation)||!Number.isFinite(b.rotation))return false;
 const distance=Math.hypot(...a.position.map((v,i)=>v-b.position[i]));
 const angle=Math.atan2(Math.sin(a.rotation-b.rotation),Math.cos(a.rotation-b.rotation));
 return distance<=positionTolerance&&Math.abs(angle)<=rotationTolerance;
}
export function furnitureStationIssue(room,catalog,station){
 if(!station||typeof station.itemId!=='string'||typeof station.kind!=='string')return '家具互动能力或目标不存在';
 const item=room?.items?.find(i=>i.id===station.itemId&&!i.stored);
 if(!item||!catalog.some(a=>a.id===item.assetId))return '家具已移走或被收纳';
 if(!finiteVector(station.position)||!Number.isFinite(station.rotation))return '家具的站位或朝向不合法';
 if(station.hands!=null&&(!Array.isArray(station.hands)||station.hands.some(p=>!finiteVector(p))))return '手部接触目标不合法';
 if(station.dependencies?.some(id=>!room.items.some(i=>i.id===id&&!i.stored)))return '组合家具缺失或已经收纳';
 if(station.seat&&!roomSeats(room,catalog).some(p=>p.itemId===station.seat.itemId&&p.seatId===station.seat.seatId)
       &&!roomBeds(room,catalog).some(p=>p.itemId===station.seat.itemId&&p.seatId===station.seat.seatId))
  return '互动座位被占用、遮挡或已失效';
 return '';
}
export function validatedFurnitureStations(room,catalog,stations,occupiedSlots=[]){
 return (stations||[]).map(station=>{
  const reason=furnitureStationIssue(room,catalog,station)||(
   station.seat&&occupiedSlots.some(s=>s?.itemId===station.seat.itemId&&s.seatId===station.seat.seatId)
    ?'这个互动点已经有人使用':''
  );
  return reason?{...station,reason:station.reason||reason}:station;
 });
}
