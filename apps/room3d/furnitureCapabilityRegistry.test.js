import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import audit from '../../docs/room3d/furniture-point-audit.json';
import {registeredFurnitureCapabilities} from './furnitureCapabilityRegistry.js';
import {usableFurniturePoints} from './furniturePointRegistry.js';
import {roomSeats,roomBeds,seatTransform} from './seating.js';
import {furnitureInteractions} from './furnitureInteractions.js';
import {plushApproachCandidates} from './plush.js';
import {readFileSync} from 'node:fs';

const asset=id=>catalog.find(a=>a.id===id);
const kinds=id=>registeredFurnitureCapabilities(asset(id)).map(c=>c.kind);
describe('home3d furniture capability registry',()=>{
 it('has an audit row for every catalog asset without making visual-pass claims',()=>{
  expect(audit.items.map(a=>a.id)).toEqual(catalog.map(a=>a.id));
  expect(audit.counts.assets).toBe(catalog.length);
  expect(audit.items.filter(a=>a.id.startsWith('halloween_'))).toHaveLength(12);
  expect(audit.counts.seats).toBe(32);
  expect(audit.counts.webglControllerSeatSlotsTested).toBe(29); // Earlier 29 were exercised; new seats still need visual sign-off.
  expect(audit.items.every(a=>a.screenValidated===false)).toBe(true);
  expect(audit.items.filter(a=>a.status==='可用且验证通过')).toHaveLength(0);
 });
 it('shares registered points rather than granting actions by browse category',()=>{
  for(const a of catalog){
   const caps=registeredFurnitureCapabilities(a);
   expect(caps.find(c=>c.kind==='sit')?.points||[]).toEqual(usableFurniturePoints(a,'seats').map(p=>p.id));
   expect(caps.find(c=>c.kind==='bed')?.points||[]).toEqual(usableFurniturePoints(a,'beds').map(p=>p.id));
  }
  expect(kinds('sofa')).toContain('sit');
  expect(kinds('kitchen_sink')).not.toContain('sit');
  expect(kinds('chair')).toContain('sit');
  expect(kinds('pouf')).toContain('sit'); // Source-derived candidate, screen QA pending.
  expect(kinds('halloween_bat_sofa')).toContain('sit');
  expect(kinds('halloween_pumpkin_armchair')).toContain('sit');
  expect(kinds('bedroom_loft')).not.toContain('bed'); // Upper berth has no safe access yet.
  expect(kinds('bath_shower')).toContain('bath');
  expect(kinds('suite_floor_mirror')).toContain('mirror');
  expect(kinds('gaming_maimai')).toContain('gaming');
 });
 it('rotates local seat anchors with an instance and excludes occupied slots',()=>{
  const room={id:'r',items:[{id:'s1',assetId:'sofa',x:1,y:.18,z:2,rotation:90,stored:false}]};
  const points=roomSeats(room,catalog);
  expect(points).toHaveLength(2);
  const local=asset('sofa').seats[0].position;
  const pose=seatTransform(room,catalog,points[0],true);
  expect(pose.position[0]).toBeCloseTo(1+local[2]);
  expect(pose.position[2]).toBeCloseTo(2-local[0]);
  const options=furnitureInteractions(room,catalog,'s1',{occupiedSeats:[points[0]]});
  expect(options.filter(x=>x.action==='chibi-sit').map(x=>x.seat)).toEqual([points[1].seatId]);
 });
 it('uses the same runtime slot feasibility for menu actions and rejects repeated sit commands',()=>{
  const room={id:'r',items:[{id:'s',assetId:'sofa',x:0,y:.18,z:0,rotation:0,stored:false}]};
  const slots=roomSeats(room,catalog),calls=[];
  const slotPlanner=s=>{calls.push(s.seatId);return s.seatId===slots[0].seatId?'入口被挡住':'';};
  const actions=furnitureInteractions(room,catalog,'s',{slotPlanner});
  expect(calls).toHaveLength(2);
  expect(actions.find(a=>a.seat===slots[0].seatId)?.reason).toBe('入口被挡住');
  expect(actions.find(a=>a.seat===slots[1].seatId)?.reason).toBe('');
  const onSeat=furnitureInteractions(room,catalog,'s',{seat:slots[0],slotPlanner});
  expect(onSeat.some(a=>a.action==='chibi-sit'&&a.seat===slots[0].seatId)).toBe(false);
  expect(onSeat.some(a=>a.action==='chibi-stand')).toBe(true);
 });
 it('keeps remote fridge buttons blocked until their door and walking station are safe',()=>{
  const room={id:'r',items:[{id:'fridge',assetId:'kitchen_fridge',x:0,y:.18,z:0,rotation:0,stored:false}]};
  const blocked=furnitureInteractions(room,catalog,'fridge',{fridgePlanner:()=> '冰箱旁没有安全通路'});
  expect(blocked).toMatchObject([{action:'fridge-toggle',reason:'冰箱旁没有安全通路'}]);
  const available=furnitureInteractions(room,catalog,'fridge',{fridgePlanner:()=>''});
  expect(available).toMatchObject([{action:'fridge-toggle',reason:''}]);
 });
 it('rotates plush approach sockets with 90-degree furniture placement and actor width',()=>{
  const room={id:'r',items:[{id:'toy',assetId:'bedroom_rabbit',x:1,y:.18,z:-1,rotation:0,stored:false}]};
  const initial=plushApproachCandidates(room,catalog,'toy',1.5);
  expect(initial).toHaveLength(20);
  expect(initial[0].position[0]).toBeCloseTo(1);
  expect(initial[0].position[2]).toBeGreaterThan(-1);
  room.items[0].rotation=90;
  const rotated=plushApproachCandidates(room,catalog,'toy',1.5);
  expect(rotated[0].position[0]).toBeGreaterThan(1);
  expect(rotated[0].position[2]).toBeCloseTo(-1);
  room.items[0].stored=true;
  expect(plushApproachCandidates(room,catalog,'toy')).toEqual([]);
 });
 it('refuses remote plush pickup and displays a concrete unavailable reason',()=>{
  const room={id:'r',items:[{id:'toy',assetId:'bedroom_rabbit',x:0,y:.18,z:0,rotation:0,stored:false}]};
  const blocked=furnitureInteractions(room,catalog,'toy',{plushPlanner:()=> '走不到玩偶身边'});
  expect(blocked).toMatchObject([{action:'chibi-hug',reason:'走不到玩偶身边'}]);
  const held=furnitureInteractions(room,catalog,'toy',{held:{itemId:'toy'},plushPlanner:()=> '走不到玩偶身边'});
  expect(held).toMatchObject([{action:'plush-put-back',reason:''}]);
  const source=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  expect(source).toContain("if(d.action==='chibi-hug'&&visitor){approachPlush(");
  expect(source).toContain('walking.arrived=begin;');
  expect(source).not.toContain("heldPlush={roomId:current().id,itemId:d.id};visitorMotion='hug'");
 });
 it('does not surface unsafe high beds even if their raw catalog has anchors',()=>{
  const room={id:'r',items:[{id:'b1',assetId:'bedroom_bunk',x:0,y:.18,z:0,rotation:0,stored:false}]};
  expect(roomBeds(room,catalog)).toEqual([]);
  const restricted=furnitureInteractions(room,catalog,'b1').filter(x=>x.action==='chibi-bed');
  expect(restricted).toHaveLength(2);
  expect(restricted.every(x=>x.reason&&/安全|路径|攀爬/.test(x.reason))).toBe(true);
  expect(restricted.some(x=>!x.reason)).toBe(false);
 });
});
