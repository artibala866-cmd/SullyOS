import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import catalog from '../../public/room3d/catalog.json';

// Geometry evidence for authored anchors, NOT a runtime pelvis/foot IK or exit test.
// These two GLBs use untransformed mesh primitives in catalog-local coordinates.
function geometry(asset){
 const bytes=readFileSync(new URL('../../public/room3d/'+asset.url,import.meta.url));
 if(bytes.toString('utf8',0,4)!=='glTF')throw Error('not a GLB');
 const jsonSize=bytes.readUInt32LE(12),json=JSON.parse(bytes.toString('utf8',20,20+jsonSize));
 const binOffset=28+jsonSize,accessor=index=>{
  const a=json.accessors[index],v=json.bufferViews[a.bufferView];
  const n={SCALAR:1,VEC3:3}[a.type],bytesPer={5126:4,5123:2,5125:4}[a.componentType];
  if(!n||!bytesPer)throw Error('unsupported GLB primitive');
  const stride=v.byteStride||n*bytesPer,offset=binOffset+(v.byteOffset||0)+(a.byteOffset||0),result=[];
  for(let i=0;i<a.count;i++){
   const p=offset+i*stride,values=Array.from({length:n},(_,k)=>{
    const q=p+k*bytesPer;
    return a.componentType===5126?bytes.readFloatLE(q):a.componentType===5123?bytes.readUInt16LE(q):bytes.readUInt32LE(q);
   });
   result.push(n===1?values[0]:values);
  }
  return result;
 };
 const triangles=[];
 for(const mesh of json.meshes)for(const primitive of mesh.primitives){
  const points=accessor(primitive.attributes.POSITION),indices=accessor(primitive.indices);
  for(let i=0;i<indices.length;i+=3)triangles.push([points[indices[i]],points[indices[i+1]],points[indices[i+2]]]);
 }
 return triangles;
}
function highestSurfaceAt(triangles,x,z){
 let height=null;
 for(const [a,b,c] of triangles){
  const det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
  if(Math.abs(det)<1e-7)continue;
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/det,
   v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/det,w=1-u-v;
  if(u<-.00001||v<-.00001||w<-.00001)continue;
  const y=u*a[1]+v*b[1]+w*c[1];
  if(height===null||y>height)height=y;
 }
 return height;
}
describe('actual GLB surfaces under bedroom bench seat anchors',()=>{
 for(const id of ['show_bedroom_bench','bedroom_ref_bench'])it(id+' seats land on highest continuous top surface',()=>{
  const asset=catalog.find(a=>a.id===id),triangles=geometry(asset);
  expect(asset.seats).toHaveLength(2);
  for(const point of asset.seats)for(const dx of [-.12,0,.12])for(const dz of [-.12,0,.12]){
   const y=highestSurfaceAt(triangles,point.position[0]+dx,point.position[2]+dz);
   expect(y).not.toBeNull();
   expect(y).toBeCloseTo(point.position[1],2);
  }
 });
});
