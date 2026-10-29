import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {bathroomHome} from './bathroomLayout.js';
import {bathroomActivities} from './bathroom.js';
import {planBathroomEntry,createBathroomJourney,bathroomJourneyObstacleIssue} from './bathroomJourney.js';
import {walkingMap,findWalkPath} from './navigation.js';
import {clearance} from './gaming.js';

function scene(){
 const home=bathroomHome(catalog),room=home.rooms[0];
 const item=room.items.find(i=>i.assetId==='bath_tub');
 const action=bathroomActivities(room,catalog,{body2:true,headWidth:1.5}).find(a=>a.kind==='bath-soak');
 const start=[0,1.2],map=walkingMap(home,room.level,catalog,{headWidth:1.5,walkClearance:true});
 return {home,room,item,action,start,map};
}
describe('bathroom entrance detection in a furnished room',()=>{
 it('reaches the real bathtub without moving or deleting existing furniture',()=>{
  const {room,item,action,start,map}=scene(),before=structuredClone(room.items);
  expect(action?.reason).toBe('');
  expect(map.free(...start)).toBe(true);
  const chosen=planBathroomEntry(room,catalog,action,item,map,start,{
   reach:{shoulderHeight:.9,armReach:.65},headWidth:1.5,startRotation:0
  });
  expect(chosen.reason,JSON.stringify(chosen)).toBeNull();
  expect(chosen.front).toBeTruthy();
  // The walk ends near the actual support rim, not at a visually clear but arm-unreachable distant tile.
  expect(Math.hypot(chosen.front[0]-action.edge[0],chosen.front[2]-action.edge[2])).toBeLessThan(.72);
  expect(chosen.path?.[0]).toEqual(start);
  expect(map.free(chosen.front[0],chosen.front[2])).toBe(true);
  expect(findWalkPath(map,start,[chosen.front[0],chosen.front[2]])).not.toBeNull();
  expect(bathroomJourneyObstacleIssue(room,catalog,action,createBathroomJourney(action,chosen.front,0),1.5)).toBe('');
  expect(room.items).toEqual(before);
 });
 it('retains the strict wide head box for ordinary furniture and uses a conservative rounded core only for bath transfer',()=>{
  const {room,action}=scene();
  const bad={...action,position:[-2.2,.18,-2.35],rotation:0};
  expect(clearance(room,catalog,bad,[action.itemId],1.5)).not.toBe('');
  expect(clearance(room,catalog,bad,[action.itemId],1.5,{headRadius:.42})).toBe('');
 });
 it('distinguishes genuine blocked entry from a harmless bathroom rug',()=>{
  const {room,item,action,start}=scene();
  expect(planBathroomEntry(room,catalog,action,item,{free:()=>false},start,{headWidth:1.5}).reason).toBe('occupied');
 });
});
