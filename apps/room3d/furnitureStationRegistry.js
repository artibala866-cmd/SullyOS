import {roomSeats,roomBeds,seatTransform} from './seating.js';
import {boxes} from './model.js';

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
  // A newly added or moved object can strike a seated actor even when the
  // seat itself hasn't moved. Check the NEW geometry, not an old nearby prop,
  // so recoloring or unrelated furniture editing stays possible.
  const hip=[from.position[0]-.38,Math.max(.18,from.position[1]-.28),from.position[2]-.38,
   from.position[0]+.38,from.position[1]+.38,from.position[2]+.38];
  const head=[from.position[0]-.54,from.position[1]+.38,from.position[2]-.54,
   from.position[0]+.54,from.position[1]+1.28,from.position[2]+.54];
  const intersects=(a,b)=>a[0]<b[3]&&a[3]>b[0]&&a[1]<b[4]&&a[4]>b[1]&&a[2]<b[5]&&a[5]>b[2];
  for(const incoming of changed.items.filter(i=>!i.stored&&i.id!==occupied.itemId)){
   const beforeItem=original.items.find(i=>i.id===incoming.id);
   if(beforeItem&&!beforeItem.stored&&['assetId','x','y','z','rotation','supportId'].every(k=>beforeItem[k]===incoming[k]))continue;
   const asset=catalog.find(a=>a.id===incoming.assetId);
   if(!asset||['rug','ceiling'].includes(asset.surface))continue;
   if(boxes(incoming,asset).some(bounds=>intersects(bounds,hip)||intersects(bounds,head)))
    return '新放置或移动的家具会碰到正在使用座位的人物，请先让人物起身';
  }
 }
 return '';
}

// Undo/redo and layout commits must not place newly moved geometry through
// a STANDING resident either. Only compare changed/new physical items; unchanged
// neighbours and paint-only edits must never become new blockers.
export function standingFurnitureChange(before,after,catalog,actor){
 if(!actor||!Number.isFinite(actor.x)||!Number.isFinite(actor.z)||!Number.isFinite(actor.width)||actor.width<=0)return '';
 const old=before?.rooms?.find(r=>r.id===actor.roomId);
 const next=after?.rooms?.find(r=>r.id===actor.roomId);
 if(!old||!next)return '';
 const half=Math.max(.28,actor.width/2),x=actor.x,z=actor.z;
 // Derive vertical collision from the ACTIVE rig's walking clearance. A low
 // resident must not be blocked by an object high above its actual head.
 const headBottom=Number.isFinite(actor.headBottom)?Math.max(.45,actor.headBottom):.72,
  headTop=Number.isFinite(actor.headTop)?Math.max(headBottom+.05,actor.headTop):1.95;
 const body=[x-.27,.18,z-.27,x+.27,headBottom,z+.27],
  head=[x-half,headBottom,z-half,x+half,headTop,z+half];
 const overlaps=(a,b)=>a[0]<b[3]&&a[3]>b[0]&&a[1]<b[4]&&a[4]>b[1]&&a[2]<b[5]&&a[5]>b[2];
 for(const candidate of next.items.filter(i=>!i.stored)){
  const original=old.items.find(i=>i.id===candidate.id);
  if(original&&!original.stored&&['assetId','x','y','z','rotation','length','supportId','dockId']
   .every(k=>original[k]===candidate[k]))continue;
  const asset=catalog.find(a=>a.id===candidate.assetId);
  if(!asset||asset.surface==='rug'||asset.surface==='ceiling')continue;
  if(boxes(candidate,asset).some(box=>overlaps(body,box)||overlaps(head,box)))
   return '这个改动会让家具穿过站立的人物，请先让人物走开';
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
export function validatedFurnitureStations(room,catalog,stations,occupiedSlots=[],actorWidth=1.5){
 return (stations||[]).map(station=>{
  const reason=furnitureStationIssue(room,catalog,station)||
   (station.seat?occupiedFurnitureSlotIssue(room,catalog,station.seat,occupiedSlots,actorWidth):'');
  return reason?{...station,reason:station.reason||reason}:station;
 });
}
