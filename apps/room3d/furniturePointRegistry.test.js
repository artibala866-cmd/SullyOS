import {describe,it,expect} from 'vitest';
import {furniturePointIssue,usableFurniturePoints,furniturePointAudit} from './furniturePointRegistry.js';
import catalog from '../../public/room3d/catalog.json';

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
});
