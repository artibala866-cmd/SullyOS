import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Matrix4,Quaternion,Vector3} from 'three';
import catalog from '../../public/room3d/catalog.json';

// Direct GLB vertex sampling: the legacy chair and pouf were initially
// calibrated from Blender source. Verify the RE-EXPORTED, JOINED asset meshes.
// Does not certify human pelvis/foot contact or count as 3D visual acceptance.
const bytes=readFileSync(new URL('../../public/room3d/kit.glb',import.meta.url));
const jsonSize=bytes.readUInt32LE(12),
 gltf=JSON.parse(bytes.toString('utf8',20,20+jsonSize)),
 binOffset=28+jsonSize,
 cache=new Map();

function readAccessor(index){
 if(cache.has(index))return cache.get(index);
 const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],
  width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],
  step={5126:4,5125:4,5123:2,5121:1}[a.componentType];
 if(!width||!step||a.sparse)throw Error('unsupported mesh accessor '+index);
 const stride=v.byteStride||width*step,base=binOffset+(v.byteOffset||0)+(a.byteOffset||0);
 const rows=Array.from({length:a.count},(_,i)=>Array.from({length:width},(_,j)=>{
  const at=base+i*stride+j*step;
  return a.componentType===5126?bytes.readFloatLE(at):
   a.componentType===5125?bytes.readUInt32LE(at):
   a.componentType===5123?bytes.readUInt16LE(at):bytes.readUInt8(at);
 }));
 cache.set(index,rows);return rows;
}
function localMatrix(node){
 if(node.matrix)return new Matrix4().fromArray(node.matrix);
 return new Matrix4().compose(
  new Vector3(...(node.translation||[0,0,0])),
  new Quaternion(...(node.rotation||[0,0,0,1])),
  new Vector3(...(node.scale||[1,1,1]))
 );
}
function trianglesFor(assetId){
 const root=gltf.nodes.findIndex(n=>n.extras?.assetId===assetId);
 if(root<0)throw Error('missing kit asset: '+assetId);
 const triangles=[];
 function traverse(id,parent){
  const node=gltf.nodes[id],world=parent.clone().multiply(localMatrix(node));
  if(node.mesh!=null)for(const primitive of gltf.meshes[node.mesh].primitives){
   const positions=readAccessor(primitive.attributes.POSITION),ids=primitive.indices==null?positions.map((_,i)=>[i]):readAccessor(primitive.indices);
   const points=positions.map(p=>new Vector3(...p).applyMatrix4(world).toArray());
   const index=ids.flat();
   for(let i=0;i+2<index.length;i+=3)triangles.push([points[index[i]],points[index[i+1]],points[index[i+2]]]);
  }
  for(const child of node.children||[])traverse(child,world);
 }
 traverse(root,new Matrix4());return triangles;
}
function hitsAt(triangles,x,z){
 const levels=[];
 for(const [a,b,c] of triangles){
  const det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
  if(Math.abs(det)<1e-7)continue;
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det,
   v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det,w=1-u-v;
  if(Math.min(u,v,w)<-.00001)continue;
  levels.push(u*a[1]+v*b[1]+w*c[1]);
 }
 return levels;
}
describe('actual exported kit mesh versus chair/pouf contact anchors',()=>{
 for(const id of ['chair','pouf'])it(id+' has real vertex-supported seat anchor, not a bbox center',()=>{
  const asset=catalog.find(a=>a.id===id),triangles=trianglesFor(id);
  expect(triangles.length).toBeGreaterThan(150);
  const slot=asset.seats[0],[x,y,z]=slot.position;
  const samples=id==='chair'?[[0,0],[-.08,0],[.08,0],[0,.08]]:[[0,0],[-.07,0],[.07,0]];
  for(const [dx,dz] of samples){
   const levels=hitsAt(triangles,x+dx,z+dz);
   expect(levels.length,id+' missed mesh at '+[dx,dz]).toBeGreaterThan(0);
   expect(Math.min(...levels.map(h=>Math.abs(h-y))),id+' contact differs from actual GLB').toBeLessThan(.13);
  }
 });
});
