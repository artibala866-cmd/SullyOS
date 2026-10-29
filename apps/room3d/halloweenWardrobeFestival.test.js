import {describe,it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import {approvedGarments,approvedPresets,cleanApprovedWardrobe} from './chibi/approvedWardrobe.ts';
import {selectedMotions,motionCategories} from './chibi/selectedMotions.ts';
import {PET_HATS,normalizePetHat} from './petWardrobe.js';
import {createPetHat} from './petHatModel.js';
import {normalizePetLife} from './petState.js';
import {createHome} from './model.js';
import catalog from '../../public/room3d/catalog.json';

const seasonal=approvedGarments.filter(g=>g.collection==='halloween');
const outfits=Object.entries(approvedPresets).filter(([,p])=>p.collection==='halloween');
const actions=selectedMotions.filter(a=>a.id.startsWith('halloween-'));
describe('Halloween 3D home costumes and seasonal interactions',()=>{
 it('adds exactly 25 independent 3D garment choices without removing legacy entries',()=>{
  expect(seasonal).toHaveLength(25);
  expect(new Set(seasonal.map(g=>g.id)).size).toBe(25);
  expect(approvedGarments.length).toBeGreaterThanOrEqual(71);
  for(const garment of seasonal){
   expect(cleanApprovedWardrobe({[garment.slot]:garment.id})[garment.slot]).toBe(garment.id);
   expect(existsSync(new URL('../../public/room3d/wardrobe/'+garment.asset,import.meta.url))).toBe(true);
   expect(existsSync(new URL('../../public/room3d/wardrobe/thumbnails/'+garment.id+'.png',import.meta.url))).toBe(true);
  }
 });
 it('has twenty independent outfits with complete garments and preserved classic presets',()=>{
  expect(outfits).toHaveLength(20);
  expect(approvedPresets.original.items.top).toBe('original-hoodie');
  for(const [,preset] of outfits){
   expect(Object.values(preset.items).every(id=>seasonal.some(g=>g.id===id))).toBe(true);
   expect(preset.clothes?.wardrobe).toEqual(preset.items);
   expect(preset.clothes?.wardrobeColors).toBeDefined();
  }
 });
 it('offers four real paired actions with authored animation clips and three temporary props',()=>{
  expect(actions).toHaveLength(4);
  expect(motionCategories.mischief).toContain('万圣节');
  for(const action of actions){
   expect(action.participants).toBe(2);
   expect(existsSync(new URL('../../public/room3d/motions/selected/'+action.file,import.meta.url))).toBe(true);
  }
  for(const prop of ['pumpkin-pail','wrapped-candy','little-ghost']){
   expect(existsSync(new URL('../../public/room3d/props/halloween/'+prop+'.glb',import.meta.url))).toBe(true);
  }
 });
 it('supports reversible, validated witch/pumpkin pet hats without changing original pet attributes',()=>{
  expect(PET_HATS.map(x=>x.id)).toEqual(['witch','pumpkin']);
  const home=createHome(catalog),raw={pets:[{id:'one',assetId:'pet_cat',name:'夜行',hat:'witch'}]};
  const validAsset=catalog.find(a=>a.petSpecies)?.id;
  expect(validAsset).toBeTruthy();raw.pets[0].assetId=validAsset;
  const life=normalizePetLife(raw,home,catalog);
  expect(life.pets[0].hat).toBe('witch');
  expect(normalizePetHat('untrusted')).toBeNull();
  for(const {id} of PET_HATS){const hat=createPetHat(id);expect(hat?.children.length).toBeGreaterThan(1);hat.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});}
  expect(createPetHat('unknown')).toBeNull();
 });
});
