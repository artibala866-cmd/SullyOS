import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import catalog from '../public/room3d/catalog.json';
import {USE_BY_ID,furnitureUse} from '../apps/room3d/furnitureCatalog.js';
import {usableFurniturePoints} from '../apps/room3d/furniturePointRegistry.js';
import {createHome,validateHome} from '../apps/room3d/model.js';
import {createPetLife} from '../apps/room3d/petLife.js';

const newPets=['pet_hamster','pet_jellyfish'];
const seasonal=catalog.filter(asset=>asset.id.startsWith('halloween_'));
const old=catalog.filter(asset=>!asset.id.startsWith('halloween_')&&!newPets.includes(asset.id));
const seatCount=assets=>assets.reduce((total,asset)=>total+(asset.seats?.length||0),0);
const find=id=>catalog.find(asset=>asset.id===id);

describe('incremental Home3D Halloween furniture and pets',()=>{
 it('retains all 248 legacy catalog entries, all 29 old seat points and all 8 bed points',()=>{
  expect(old).toHaveLength(248);
  expect(seatCount(old)).toBe(29);
  expect(old.reduce((total,asset)=>total+(asset.beds?.length||0),0)).toBe(8);
  expect(new Set(catalog.map(asset=>asset.id)).size).toBe(catalog.length);
 });
 it('registers twelve seasonal assets with exactly three new, usable seats and browser categories',()=>{
  expect(seasonal).toHaveLength(12);
  expect(seatCount(seasonal)).toBe(3);
  expect(seatCount(catalog)).toBe(32);
  expect(usableFurniturePoints(find('halloween_bat_sofa'),'seats')).toHaveLength(2);
  expect(usableFurniturePoints(find('halloween_pumpkin_armchair'),'seats')).toHaveLength(1);
  for(const asset of seasonal){expect(USE_BY_ID[asset.id],asset.id).toBeTruthy();expect(furnitureUse(asset)).toBe(USE_BY_ID[asset.id]);}
 });
 it('ships the original GLB binary and thumbnail for each newly registered asset',()=>{
  for(const asset of [...seasonal,...newPets.map(find)]){
   // New Meshopt-compressed GLBs must use the configured loader, not an unconfigured default.
   const loaderSource=readFileSync('apps/room3d/editor.js','utf8');
   expect(loaderSource).toContain('setMeshoptDecoder(MeshoptDecoder)');
   expect(asset?.url).toBeTruthy();
   const model=readFileSync('public/room3d/'+asset.url);
   expect(model.toString('ascii',0,4),asset.id).toBe('glTF');
   expect(model.readUInt32LE(8),asset.id).toBe(model.length);
   const thumb=readFileSync('public/room3d/thumbnails/'+asset.id+'.png');
   expect(thumb.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),asset.id).toBe(true);
  }
 });
 it('offers both pet species without changing the seven-pet household cap or old saves',()=>{
  expect(catalog.filter(asset=>asset.petSpecies)).toHaveLength(9);
  expect(newPets.map(id=>find(id)?.petSpecies)).toEqual(['hamster','jellyfish']);
  const home=createHome(catalog),snapshot=structuredClone(home);
  expect(validateHome(snapshot,catalog).rooms[0].items).toEqual(home.rooms[0].items);
  home.rooms[0].items=[];
  const life=createPetLife({home:()=>home,catalog});
  life.adopt('pet_hamster','小仓鼠');
  life.adopt('pet_jellyfish','小水母');
  expect(life.data.pets.map(p=>p.assetId)).toEqual(newPets);
 });
});
