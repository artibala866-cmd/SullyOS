import {seatTransform} from './seating.js';

/** Lap pillow needs two different places on the SAME upholstered sofa.
 * Dining benches, individual armchairs, poufs and beds cannot be substituted.
 * Read the furniture's seat metadata instead of guessing from world distance.
 */
export const SOFA_LAP_PILLOW_ID='home-sofa-lap-pillow';
export const eligibleLapSofa=(assetId:string)=>[
 'sofa','petal_sofa','show_living_sofa','living_ref_sofa'
].includes(assetId);
export type SofaSeatSelection={itemId:string;seatId:string;roomId:string;bed?:boolean}|null|undefined;
export function sofaLapPillowSeatPair(room:any,catalog:any[],
 a:SofaSeatSelection,b:SofaSeatSelection){
 if(!a||!b||a.bed||b.bed||a.roomId!==room.id||b.roomId!==room.id||
    a.itemId!==b.itemId||a.seatId===b.seatId)return null;
 const item=room.items.find((i:any)=>i.id===a.itemId&&!i.stored);
 if(!item||!eligibleLapSofa(item.assetId))return null;
 const asset=catalog.find((entry:any)=>entry.id===item.assetId);
 if(!asset||!Array.isArray(asset.seats)||asset.seats.length<2)return null;
 const left=seatTransform(room,catalog,a,true),right=seatTransform(room,catalog,b,true);
 if(!left||!right||left.pose!=='chair'||right.pose!=='chair')return null;
 const distance=Math.hypot(left.position[0]-right.position[0],left.position[2]-right.position[2]);
 const facing=Math.abs(Math.atan2(Math.sin(left.rotation-right.rotation),Math.cos(left.rotation-right.rotation)));
 if(distance<.75||distance>2.15||facing>.25)return null;
 return {itemId:item.id,seatA:left,seatB:right,distance};
}
