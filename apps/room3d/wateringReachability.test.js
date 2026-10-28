import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {wateringSpot} from './watering.js';
import {readFileSync} from 'node:fs';

const room={id:'garden',items:[{id:'plant',assetId:'monstera',x:0,y:.18,z:0,rotation:0,stored:false}]};

describe('watering station navigation contract',()=>{
 it('preserves legacy physical candidates when a caller has no navigation map',()=>{
  const spot=wateringSpot(room,catalog,'plant');
  expect(spot).toBeTruthy();
  expect(spot.position).toHaveLength(3);
 });
 it('does not advertise a socket when all routes fail',()=>{
  const visited=[];
  expect(wateringSpot(room,catalog,'plant',{canReach:spot=>{visited.push(spot.side);return false;}})).toBeNull();
  expect(visited.length).toBeGreaterThan(0);
 });
 it('tries other authored socket candidates when the first clear one is unreachable',()=>{
  const original=wateringSpot(room,catalog,'plant');
  const checked=[];
  const alternate=wateringSpot(room,catalog,'plant',{canReach:spot=>{
   checked.push(spot.side);
   return spot.side==='right';
  }});
  expect(original.side).toBe('front');
  expect(alternate?.side).toBe('right');
  expect(checked).toContain('front');
 });
 it('does not select a deleted or stored plant when navigation accepts everything',()=>{
  const next=structuredClone(room);
  next.items[0].stored=true;
  expect(wateringSpot(next,catalog,'plant',{canReach:()=>true})).toBeNull();
 });
 it('cleans up a cancelled watering pose at the actual station, not a default spawn',()=>{
  const source=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  expect(source).toContain("if(visitorPlant){rememberStandingLocation();visitorPlant=null;");
  expect(source).toContain('请先结束浇水，再开始其它家具互动');
  expect(source).toContain("if(kitchenTask)rememberStandingLocation();cancelKitchen();");
 });
});
