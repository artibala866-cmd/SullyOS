import {describe,it,expect,vi,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createBlankBody} from './chibi/blankBody';
import {bindBlankBody} from './chibi/blankRig';
import {dressApprovedWardrobe} from './chibi/approvedClothing';
import {approvedGarments,approvedPresets} from './chibi/approvedWardrobe';
import {attachPetHat} from './petHatModel.js';
import {createHalloweenProp,loadHalloweenProps} from './chibi/halloweenProps';
import {normalizePetLife} from './petState.js';
import {createHome} from './model.js';
import catalog from '../../public/room3d/catalog.json';
import type {ChibiVisitor} from './chibi/visitor';

vi.stubGlobal('self',globalThis);
vi.stubGlobal('createImageBitmap',async()=>({width:1,height:1,close(){}}));
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const fromDisk=async(path:string)=>{
 const bytes=readFileSync('public/room3d/'+path);
 return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
};
const original=GLTFLoader.prototype.loadAsync;
vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
 const path=String(url).split('room3d/')[1]?.split('?')[0];
 if(!path)throw Error('Bad source path: '+url);
 return fromDisk(path);
});
afterAll(()=>{GLTFLoader.prototype.loadAsync=original;vi.unstubAllGlobals();vi.restoreAllMocks();});
const garments=approvedGarments.filter(x=>x.collection==='halloween');
const presets=Object.entries(approvedPresets).filter(([,v])=>v.collection==='halloween');

describe('Halloween authored 3D asset integration acceptance',()=>{
 it('wears every one of 25 GLB pieces and all 20 fully dressed palettes, restoring unmodified skin on each swap',async()=>{
  expect(garments).toHaveLength(25);expect(presets).toHaveLength(20);
  const root=new T.Group(),base=new T.Mesh(createBlankBody('skin'),new T.MeshStandardMaterial()),hair=new T.Group();root.add(base,hair);
  const rig=bindBlankBody(base,hair,true);
  const check=async(items:Record<string,string>,colors:Record<string,Record<string,string>>={},label='')=>{
   const outfit=await dressApprovedWardrobe(rig,items,{},colors,true);
   try{
    const visible=new Set(outfit.meshes.map(m=>m.userData.garmentId));
    expect(visible.size,label).toBe(Object.keys(items).length);
    root.updateMatrixWorld(true);rig.skeleton.update();
    for(const mesh of outfit.meshes){
     const g=mesh.geometry,p=g.attributes.position;
     expect(g.index?.count,label).toBeGreaterThan(0);
     expect(p.count,label).toBeGreaterThan(0);
     for(const attr of Object.values(g.attributes))for(let j=0;j<attr.count;j+=Math.max(1,Math.floor(attr.count/110))){
      for(let axis=0;axis<attr.itemSize;axis++)expect(Number.isFinite(attr.getComponent(j,axis)),label+': '+mesh.name).toBe(true);
     }
     if(g.attributes.skinIndex)for(let i=0;i<g.attributes.skinIndex.count;i+=Math.max(1,Math.floor(g.attributes.skinIndex.count/100))){
      for(let k=0;k<4;k++)expect(g.attributes.skinIndex.getComponent(i,k),mesh.name).toBeLessThan(rig.skeleton.bones.length);
     }
     const v=new T.Vector3();
     for(let j=0;j<p.count;j+=Math.max(1,Math.floor(p.count/110))){
      mesh.getVertexPosition(j,v);expect(v.toArray().every(Number.isFinite),label+': skinned '+mesh.name).toBe(true);
     }
    }
    // Every outfit must keep its own dyed materials and leave no global source geometry changes.
    outfit.updateColors(colors);
   }finally{outfit.dispose();}
   expect(rig.mesh.geometry,label+': skin restore').toBe(rig.baseGeometry);
   expect(root.children.filter(o=>o.name.startsWith('wardrobe:')),label+': detached meshes').toHaveLength(0);
  };
  for(const g of garments)await check({[g.slot]:g.id},{},g.id);
  for(const [id,outfit] of presets)await check(outfit.items,outfit.clothes?.wardrobeColors??{},id);
  rig.baseGeometry.dispose();base.material.dispose();rig.skeleton.dispose();
 },600_000);

 it('anchors both removable hats to all nine actual pet GLBs and preserves save roundtrips',async()=>{
  const species=catalog.filter(x=>x.petSpecies);expect(species).toHaveLength(9);
  for(const asset of species){
   const {scene}=await fromDisk(asset.url);
   for(const type of ['witch','pumpkin']){
    const visual=scene.clone(true);visual.scale.setScalar(.75);
    const hat=attachPetHat(visual,type,asset);
    expect(hat?.name).toBe('pet-hat-'+type);
    expect(hat?.parent).toBe(visual);
    visual.updateWorldMatrix(true,true);
    const hatBounds=new T.Box3().setFromObject(hat!),bodyBounds=new T.Box3().setFromObject(scene);
    expect(hatBounds.isEmpty(),asset.id+': '+type).toBe(false);
    for(const n of [...hat!.position.toArray(),...hat!.scale.toArray()])expect(Number.isFinite(n),asset.id).toBe(true);
    expect(hatBounds.getCenter(new T.Vector3()).y,asset.id+': hat must be above middle').toBeGreaterThan(bodyBounds.min.y*.75+bodyBounds.getSize(new T.Vector3()).y*.28);
    hat?.removeFromParent();
    hat?.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
    expect(visual.children.some(x=>x.userData.petHat),asset.id).toBe(false);
   }
   scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
  }
  const home=createHome(catalog),spec=species[0];
  const pet={id:'saved-hat',assetId:spec.id,name:'小幽灵',hat:'witch'};
  expect(normalizePetLife({pets:[pet]},home,catalog).pets[0].hat).toBe('witch');
  expect(normalizePetLife({pets:[{...pet,hat:'pumpkin'}]},home,catalog).pets[0].hat).toBe('pumpkin');
  expect(normalizePetLife({pets:[{...pet,hat:null}]},home,catalog).pets[0]).not.toHaveProperty('hat');
  expect(normalizePetLife({pets:[{...pet,hat:'bad'}]},home,catalog).pets[0]).not.toHaveProperty('hat');
 },300_000);

 it('loads all three real GLB props, updates timed contacts for four actions, and removes session props',async()=>{
  const names=['pumpkin-pail','wrapped-candy','little-ghost'];
  const templates:Record<string,T.Group>={};
  for(const id of names){const {scene}=await fromDisk('props/halloween/'+id+'.glb');templates[id]=scene;let found=0;scene.traverse(o=>{if(o instanceof T.Mesh){expect(o.geometry.attributes.position.count).toBeGreaterThan(3);found++;}});expect(found,id).toBeGreaterThan(0);}
  const parent=new T.Group(),actors=[new T.Group(),new T.Group()];
  actors.forEach((a,i)=>{a.position.x=i*.8;parent.add(a);});
  const visitors=actors.map(root=>({root,rig:null,classicPoint:(part:string)=>new T.Vector3(root.position.x,1,part.startsWith('L')?.2:-.2)}) as unknown as ChibiVisitor);
  for(const id of ['halloween-boo','halloween-trick-or-treat','halloween-candy-shower','halloween-ghost-tease']){
   const loaded=await loadHalloweenProps(id);
   const prop=createHalloweenProp(id,visitors,loaded);
   if(id==='halloween-boo'){expect(prop).toBeNull();continue;}
   expect(prop,id).not.toBeNull();
   for(const t of [0.5,1.5,3.2,4.5,7.8]){prop!.update(t,8,1);parent.updateWorldMatrix(true,true);parent.traverse(o=>{if(o.name==='halloween-social-props')expect(o.visible).toBe(t<7.55);});}
   prop!.dispose();expect(parent.children.some(x=>x.name==='halloween-social-props'),id).toBe(false);
  }
  for(const g of Object.values(templates))g.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
 },120_000);
});
