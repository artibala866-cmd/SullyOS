import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {
 downloadResourcePack,removeResourcePack,resourcePackStatus,readPackAsset,
 resourcePacks,type PackFile,type ResourcePack
} from '../apps/room3d/resourcePacks';

const id='halloween-furniture';
const sofa='room3d/halloween_bat_sofa.glb',rug='room3d/halloween_bat_rug.glb';
const file=(path:string,contents:string):PackFile=>({path,bytes:Buffer.byteLength(contents),sha256:createHash('sha256').update(contents).digest('hex'),dependencies:[]});
function pack(revision='one'):ResourcePack{
 const files=[file(sofa,revision),file(rug,revision.toUpperCase())];
 return {id,name:'测试万圣节资源包',description:'',revision,bytes:files.reduce((n,f)=>n+f.bytes,0),files};
}
const url=(path:string)=>'https://local.invalid/'+path;
const response=(address:string,version='one')=>new Response(address.includes('bat_rug')?version.toUpperCase():version);

beforeEach(async()=>{
 vi.stubGlobal('location',{href:'https://local.invalid/'});
 await removeResourcePack(id);
});
afterEach(async()=>{
 await removeResourcePack(id);
 vi.unstubAllGlobals();vi.restoreAllMocks();
});

describe('optional Halloween furniture caching in IndexedDB',()=>{
 it('retains the original public furniture manifest and does not open storage for ordinary GLBs',async()=>{
  expect(resourcePacks.map(p=>p.id)).toEqual([id,'halloween-wardrobe']);
  const open=vi.spyOn(indexedDB,'open');
  expect(await readPackAsset(url('room3d/kit.glb'))).toBeUndefined();
  expect(open).not.toHaveBeenCalled();
 });
 it('downloads hashed assets, persists them and serves the original furniture model with no later network fetch',async()=>{
  const fetch=vi.fn(async(address:string)=>response(address));vi.stubGlobal('fetch',fetch);
  await downloadResourcePack(pack());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([address])=>address.startsWith('/room3d/'))).toBe(true);
  expect(await resourcePackStatus(pack())).toMatchObject({installed:true,savedBytes:6});
  fetch.mockImplementation(async()=>{throw Error('offline');});
  const local=await readPackAsset(url(sofa));
  expect(await local?.blob.text()).toBe('one');
  expect(local?.dependencies.size).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('resumes the missing asset without activating an incomplete resource pack',async()=>{
  const fetch=vi.fn(async(address:string)=>address.includes('bat_rug')?new Response('',{status:503}):response(address));
  vi.stubGlobal('fetch',fetch);
  await expect(downloadResourcePack(pack())).rejects.toThrow('503');
  expect(await readPackAsset(url(sofa))).toBeUndefined();
  expect(await resourcePackStatus(pack())).toMatchObject({installed:false,savedBytes:3});
  fetch.mockClear();fetch.mockImplementation(async(address:string)=>response(address));
  await downloadResourcePack(pack());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('bat_rug');
  expect(await resourcePackStatus(pack())).toMatchObject({installed:true,savedBytes:6});
 });
 it('keeps the complete older generation readable if a new pack fails integrity validation',async()=>{
  const fetch=vi.fn(async(address:string)=>response(address));vi.stubGlobal('fetch',fetch);
  await downloadResourcePack(pack());
  fetch.mockImplementation(async()=>new Response('invalid'));
  await expect(downloadResourcePack(pack('two'))).rejects.toThrow('校验');
  expect(await resourcePackStatus(pack('two'))).toMatchObject({installed:true,update:true});
  expect(await (await readPackAsset(url(sofa)))?.blob.text()).toBe('one');
  fetch.mockImplementation(async(address:string)=>response(address,'two'));
  await downloadResourcePack(pack('two'));
  expect(await (await readPackAsset(url(sofa)))?.blob.text()).toBe('two');
  expect(await resourcePackStatus(pack('two'))).toMatchObject({installed:true,update:false});
 });
});
