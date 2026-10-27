import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {diningActivities,canUseAsDiningSurface} from './dining.js';
import {registeredFurnitureCapabilities} from './furnitureCapabilityRegistry.js';
import {dockSlots} from './furnitureDock.js';
import {seatTransform} from './seating.js';

const asset=id=>catalog.find(a=>a.id===id);
describe('reusable dining surfaces with existing dock positions',()=>{
 it('offers dining on supported worktables, but never on low coffee tables or high vanities',()=>{
  expect(canUseAsDiningSurface(asset('worktable'))).toBe(true);
  expect(canUseAsDiningSurface(asset('dining_table'))).toBe(true);
  expect(canUseAsDiningSurface(asset('table'))).toBe(false);
  expect(canUseAsDiningSurface(asset('bedroom_vanity'))).toBe(false);
  expect(registeredFurnitureCapabilities(asset('worktable')).map(a=>a.kind)).toContain('dining');
 });
 it('allows the original wood chair to eat at the blank worktable through the same hand and bowl goals',()=>{
  const table={id:'t',assetId:'worktable',x:0,y:.15,z:0,rotation:0,color:null,stored:false};
  const chair={id:'s',assetId:'chair',x:0,y:.15,z:0,rotation:0,color:null,stored:false};
  const room={id:'r',items:[table,chair]},positions=dockSlots(table,chair,room,catalog);
  expect(positions.length).toBeGreaterThan(0);
  Object.assign(chair,positions[0]);
  const activities=diningActivities(room,catalog);
  expect(activities).toHaveLength(1);
  expect(activities[0].kind).toBe('eat');
  expect(activities[0].seat).toMatchObject({itemId:'s',seatId:'center'});
  expect(activities[0].reason).toBe('');
  expect(activities[0].hands).toHaveLength(2);
 });
 it('skips a blocked island bench seat rather than throwing while computing menus',()=>{
  const table={id:'t',assetId:'show_kitchen_island',x:0,y:.18,z:0,rotation:0,stored:false};
  const bench={id:'b',assetId:'show_kitchen_bench',x:0,y:.18,z:1.4,rotation:180,stored:false};
  const room={id:'r',items:[table,bench]};
  const seat={roomId:'r',itemId:'b',seatId:'0',dining:true};
  const pose=seatTransform(room,catalog,seat);
  expect(pose).toBeTruthy();
  room.items.push({id:'prop',assetId:'bedroom_ref_sleeping_cat',
   x:pose.position[0],y:pose.position[1],z:pose.position[2],
   rotation:0,supportId:'b',stored:false});
  expect(seatTransform(room,catalog,seat)).toBeNull();
  const options=diningActivities(room,catalog);
  expect(options.every(a=>a.seat?.seatId!=='0')).toBe(true);
 });
});
