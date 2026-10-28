import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import catalog from '../../public/room3d/catalog.json';

// File/mesh coverage is independent of the browser. This proves that every
// catalog asset resolves to geometry, NOT that contact/IK looks correct in 3D.
const cache=new Map();
function loadGLB(filename){
 if(cache.has(filename))return cache.get(filename);
 const bytes=readFileSync(new URL('../../public/room3d/'+filename,import.meta.url));
 if(bytes.toString('utf8',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error(filename+': invalid GLB header');
 const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
 if(!Array.isArray(json.meshes)||!Array.isArray(json.nodes)||!Array.isArray(json.accessors))throw Error(filename+': missing mesh document');
 const meshCount=mesh=>{
  if(!mesh)return 0;
  return mesh.primitives.reduce((sum,p)=>{
   const position=json.accessors[p.attributes?.POSITION],indices=p.indices!=null?json.accessors[p.indices]:null;
   if(!position||position.type!=='VEC3'||position.count<3||!position.min?.every(Number.isFinite)||!position.max?.every(Number.isFinite))throw Error(filename+': invalid mesh POSITION');
   if(indices&&(!Number.isInteger(indices.count)||indices.count<3))throw Error(filename+': invalid triangle indices');
   return sum+(indices?.count??position.count)/3;
  },0);
 };
 const triByMesh=json.meshes.map(meshCount);
 const result={json,triByMesh,totalTriangles:triByMesh.reduce((n,k)=>n+k,0)};
 cache.set(filename,result);return result;
}
function kitTriangles(kit,id){
 const {nodes}=kit.json,n=nodes.findIndex(node=>node.extras?.assetId===id);
 if(n<0)throw Error('kit.glb asset root not found: '+id);
 const visited=new Set();
 function count(index){
  if(visited.has(index))return 0;visited.add(index);
  const node=nodes[index];
  return (node.mesh==null?0:kit.triByMesh[node.mesh])+(node.children||[]).reduce((sum,i)=>sum+count(i),0);
 }
 return count(n);
}
describe('whole catalog geometry-level coverage (not visual acceptance)',()=>{
 it('resolves all 248 records to real GLB mesh geometry',()=>{
  const kit=loadGLB('kit.glb'),missing=[],invalid=[];
  let external=0,builtIn=0,meshes=0;
  for(const asset of catalog){
   try{
    const tri=asset.url?(external++,loadGLB(asset.url).totalTriangles):(builtIn++,kitTriangles(kit,asset.id));
    if(!(tri>0))missing.push(asset.id);
    meshes+=tri;
   }catch(e){invalid.push(asset.id+': '+String(e.message));}
  }
  expect({missing,invalid}).toEqual({missing:[],invalid:[]});
  expect(external+builtIn).toBe(catalog.length);
  expect(external).toBeGreaterThan(200);
  expect(meshes).toBeGreaterThan(1000);
 });
});
