import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import catalog from '../public/room3d/catalog.json';
import {createHome,validateHome} from '../apps/room3d/model.js';
import {addActivityRoom} from '../apps/room3d/activityRooms.js';
import {resourcePacks} from '../apps/room3d/resourcePacks';

describe('Halloween annex and optional furniture resource pack',()=>{
 it('adds a separate furnished room without replacing any existing items, then reopens it idempotently',()=>{
  const home=createHome(catalog),before=structuredClone(home.rooms);
  const room=addActivityRoom(home,'halloween',catalog);
  expect(home.rooms).toHaveLength(before.length+1);
  expect(home.rooms.slice(0,-1)).toEqual(before);
  expect(room.activityRoom).toBe('halloween');
  expect(room.level).toBe(0);
  expect(room.items).toHaveLength(12);
  expect(new Set(room.items.map(item=>item.assetId))).toEqual(new Set(catalog.filter(a=>a.id.startsWith('halloween_')).map(a=>a.id)));
  expect(home.activeRoomId).toBe(room.id);
  expect(validateHome(structuredClone(home),catalog).rooms.find(r=>r.id===room.id)?.items).toHaveLength(12);
  expect(addActivityRoom(home,'halloween',catalog).id).toBe(room.id);
  expect(home.rooms).toHaveLength(before.length+1);
 });
 it('does not create partial rooms if capacity or placement constraints fail',()=>{
  const home=createHome(catalog);
  const snapshot=structuredClone(home);
  expect(()=>addActivityRoom(home,'no-such-event',catalog)).toThrow();
  expect(home).toEqual(snapshot);
  const withoutLantern=catalog.filter(a=>a.id!=='halloween_pumpkin_lantern');
  expect(()=>addActivityRoom(home,'halloween',withoutLantern)).toThrow();
  expect(home).toEqual(snapshot);
 });
 it('provides exactly the existing 12 furniture models and thumbnails with content hashes',()=>{
  const [pack]=resourcePacks;
  expect(resourcePacks.map(p=>p.id)).toEqual(['halloween-furniture','halloween-wardrobe']);
  expect(pack.files).toHaveLength(24);
  expect(pack.bytes).toBe(pack.files.reduce((n,f)=>n+f.bytes,0));
  for(const file of pack.files){
   const bytes=readFileSync('public/'+file.path);
   expect(bytes.length,file.path).toBe(file.bytes);
   expect(createHash('sha256').update(bytes).digest('hex'),file.path).toBe(file.sha256);
   expect(file.dependencies).toEqual([]);
  }
 });
});
