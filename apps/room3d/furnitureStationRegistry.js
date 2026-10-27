import {roomSeats,roomBeds,seatTransform} from './seating.js';

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

// Same-slot reservations alone do not protect wide-headed residents seated
// on nearby authored points (e.g. two bench positions or adjacent chairs).
// Preserve ordinary dual-sofa use; only measured extra width expands clearance.
// An excluded point remains in the catalog; we never invent or move a seat.
export function occupiedFurnitureSlotIssue(room,catalog,slot,occupiedSlots=[],actorWidth=1.5){
 if(!slot||!room||!Array.isArray(occupiedSlots))return '';
 const actor=seatTransform(room,catalog,slot,true),w=Math.max(1.5,Number.isFinite(actorWidth)?actorWidth:1.5);
 for(const taken of occupiedSlots.filter(Boolean)){
  if(taken.roomId&&taken.roomId!==room.id)continue;
  if(taken.itemId===slot.itemId&&taken.seatId===slot.seatId)return '这个互动点已经有人使用';
  if(!actor)continue;
  const other=seatTransform(room,catalog,{...taken,roomId:room.id},true);
  if(!other)continue;
  const measured=Number.isFinite(taken.width)?taken.width:1.5,
   distance=Math.hypot(actor.position[0]-other.position[0],actor.position[2]-other.position[2]),
   clearance=Math.max(1.15,(w+Math.max(1.5,measured))/2-.35);
  if(Math.abs(actor.position[1]-other.position[1])<1.1&&distance<clearance)
   return '相邻互动位有人使用，角色体型可能互相穿模';
 }
 return '';
}

// Furniture saves must not teleport a seated resident to a moved model or
// let a newly supported decoration intersect an occupied cushion.
// This is only a commit-time guard: it never edits a saved seat or room layout.
export function occupiedFurnitureChange(before,after,catalog,occupiedSeats=[]){
 for(const occupied of occupiedSeats.filter(Boolean)){
  const original=before?.rooms?.find(r=>r.id===occupied.roomId&&r.items.some(i=>i.id===occupied.itemId&&!i.stored));
  if(!original)continue;
  const changed=after?.rooms?.find(r=>r.id===occupied.roomId&&r.items.some(i=>i.id===occupied.itemId&&!i.stored));
  const fromItem=original.items.find(i=>i.id===occupied.itemId);
  const toItem=changed?.items.find(i=>i.id===occupied.itemId);
  const from=seatTransform(original,catalog,occupied,true);
  const to=changed&&seatTransform(changed,catalog,occupied,true);
  if(!changed||fromItem.assetId!==toItem?.assetId||!from||!sameStationPose(from,to))
   return '座位或床位正在使用，请先让人物正常起身，再移动、收纳或遮挡这件家具';
 }
 return '';
}

// Preserve active appliance/mirror/watering contact against layout mutations.
// Ignore colors and unrelated decoration: only physical identity, attachment,
// placement and orientation invalidate a running action.
export function activeFurnitureDependencyChange(before,after,actions=[]){
 for(const action of actions.filter(Boolean)){
  const ids=[action.itemId,action.seat?.itemId,action.parentId,...(action.dependencies||[])].filter(Boolean);
  for(const id of new Set(ids)){
   const room=before?.rooms?.find(r=>r.items.some(i=>i.id===id&&!i.stored));
   if(!room)continue;
   const oldItem=room.items.find(i=>i.id===id),nextItem=after?.rooms?.find(r=>r.id===room.id)?.items.find(i=>i.id===id);
   const physical=i=>i&&[i.assetId,i.x,i.y,i.z,i.rotation,!!i.stored,i.supportId||'',i.dockId||''].join('|');
   if(!nextItem||physical(oldItem)!==physical(nextItem))
    return '人物正在使用关联家具，请先结束互动，再移动、旋转或收纳设备';
  }
 }
 return '';
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
