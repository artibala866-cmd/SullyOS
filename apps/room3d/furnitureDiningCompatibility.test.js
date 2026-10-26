import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {diningActivities,canUseAsDiningSurface} from './dining.js';
import {registeredFurnitureCapabilities} from './furnitureCapabilityRegistry.js';
import {dockSlots} from './furnitureDock.js';

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
});
