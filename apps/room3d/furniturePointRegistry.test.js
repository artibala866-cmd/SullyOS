import {describe,it,expect} from 'vitest';
import {furniturePointIssue,usableFurniturePoints,furniturePointAudit} from './furniturePointRegistry.js';
import catalog from '../../public/room3d/catalog.json';
import {furnitureInteractions} from './furnitureInteractions.js';

describe('home3d furniture point coverage (metadata only, not visual QA)',()=>{
 it('accounts for every catalog entry and does not report mesh review as completed',()=>{
  const entries=furniturePointAudit(catalog);
  expect(entries).toHaveLength(catalog.length);
  expect(new Set(entries.map(a=>a.id)).size).toBe(catalog.length);
  expect(entries.every(a=>a.status!=='可用且验证通过')).toBe(true);
  expect(entries.some(a=>a.id==='chair'&&a.status==='已配置但尚未完成画面验证')).toBe(true);
  expect(entries.some(a=>a.id==='pouf'&&a.status==='已配置但尚未完成画面验证')).toBe(true);
 });
 it('rejects invalid, duplicate and raised bed anchors without silently inventing a point',()=>{
  const bed=catalog.find(a=>a.id==='bedroom_bunk');
  expect(usableFurniturePoints(bed,'beds')).toEqual([]);
  const loft=catalog.find(a=>a.id==='bedroom_loft');
  expect(usableFurniturePoints(loft,'beds')).toEqual([]);
  const invalid={id:'wrong',position:[Infinity,1,0]};
  expect(furniturePointIssue(bed,invalid,'beds')).toBeTruthy();
  const seat=catalog.find(a=>a.id==='sofa');
  expect(usableFurniturePoints({...seat,seats:[seat.seats[0],seat.seats[0]]},'seats')).toHaveLength(1);
 });
 it('advertises why high beds are disabled but never exposes a callable bed point',()=>{
  for(const id of ['bedroom_bunk','bedroom_loft','loft']){
   const room={id:'r',items:[{id:'high',assetId:id,x:0,y:.18,z:0,rotation:0,stored:false}]};
   const buttons=furnitureInteractions(room,catalog,'high').filter(a=>a.action==='chibi-bed');
   expect(buttons.length,id).toBeGreaterThan(0);
   expect(buttons.every(a=>!!a.reason),id).toBe(true);
   expect(buttons.some(a=>!a.reason),id).toBe(false);
  }
  const room={id:'r',items:[{id:'single',assetId:'bedroom_single_bed',
   x:0,y:.18,z:0,rotation:0,stored:false}]};
  expect(furnitureInteractions(room,catalog,'single').some(a=>a.action==='chibi-bed'&&!a.reason)).toBe(true);
 });

});
