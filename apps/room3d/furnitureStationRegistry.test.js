import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {furnitureStationIssue,validatedFurnitureStations} from './furnitureStationRegistry.js';

const room={id:'r',items:[
 {id:'t',assetId:'worktable',x:0,y:.15,z:0,rotation:0,stored:false},
 {id:'c',assetId:'chair',x:0,y:.15,z:1,rotation:180,stored:false}
]};
const station={itemId:'t',kind:'eat',stationId:'c',position:[0,.695,1],rotation:0,
 hands:[[-.25,.50,.40],[.25,.50,.40]],seat:{roomId:'r',itemId:'c',seatId:'center'},dependencies:['c']};
describe('shared furniture interaction station validation',()=>{
 it('accepts a real target, calibrated seat and current dependencies',()=>{
  expect(furnitureStationIssue(room,catalog,station)).toBe('');
  expect(validatedFurnitureStations(room,catalog,[station])[0].reason).toBeUndefined();
 });
 it('refuses missing, stored, corrupt and dangling contact points',()=>{
  expect(furnitureStationIssue(room,catalog,{...station,itemId:'unknown'})).toContain('家具');
  expect(furnitureStationIssue(room,catalog,{...station,position:[NaN,.1,0]})).toContain('站位');
  expect(furnitureStationIssue(room,catalog,{...station,hands:[[Infinity,1,0]]})).toContain('手部');
  expect(furnitureStationIssue(room,catalog,{...station,dependencies:['missing']})).toContain('缺失');
  expect(furnitureStationIssue(room,catalog,{...station,seat:{...station.seat,seatId:'missing'}})).toContain('座位');
  const stored={...room,items:room.items.map(i=>i.id==='c'?{...i,stored:true}:i)};
  expect(furnitureStationIssue(stored,catalog,station)).toContain('缺失');
 });
 it('reserves a seat across the action wheel and AI planner without losing the blocked reason',()=>{
  const [blocked]=validatedFurnitureStations(room,catalog,[station],[{itemId:'c',seatId:'center'}]);
  expect(blocked.reason).toContain('已经有人');
  expect(validatedFurnitureStations(room,catalog,[{...station,reason:'设备坏了'}],[{itemId:'c',seatId:'center'}])[0].reason).toBe('设备坏了');
 });
});
