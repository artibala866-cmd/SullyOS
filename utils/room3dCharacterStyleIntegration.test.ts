import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {setCharacterIllustration,setCharacterRoomLighting,setCharacterRoomTint} from '../apps/room3d/chibi/illustration';
import {getCharacterStyle,setCharacterStyle} from '../apps/room3d/chibi/characterStyle';
import {readFileSync} from 'node:fs';

describe('incremental Home3D character style switching',()=>{
 it('retains the original classic shader, adds a separate modern shader and restores original material without losing geometry',()=>{
  const geometry=new T.BoxGeometry(1,1,1),material=new T.MeshStandardMaterial({color:'#aaccff'});
  material.userData.illustrationFace=true;
  const mesh=new T.Mesh(geometry,material),root=new T.Group();root.add(mesh);
  const initialKey=material.customProgramCacheKey(),initialCompile=material.onBeforeCompile,originalGeometry=mesh.geometry,originalMap=material.map;
  setCharacterIllustration(root,true,'legacy');
  const classicKey=material.customProgramCacheKey();
  expect(classicKey).toMatch(/-character-illustration-v\d+-legacy/);
  setCharacterRoomTint(root,'#ffddaa');
  setCharacterRoomLighting(root,{roomShadeTint:{value:new T.Color('#dddddd')},roomSunTint:{value:new T.Color('#ffffff')},roomBrightness:{value:1},roomSunContrast:{value:0}});
  setCharacterIllustration(root,true,'modern');
  expect(material.customProgramCacheKey()).toMatch(/-character-illustration-v\d+-modern/);
  expect(mesh.geometry).toBe(originalGeometry);
  expect(material.map).toBe(originalMap);
  setCharacterIllustration(root,true,'illustrated');
  expect(material.customProgramCacheKey()).toMatch(/-character-illustration-v\d+-illustrated/);
  expect(material.map).toBe(originalMap);
  expect(mesh.geometry).toBe(originalGeometry);
  setCharacterIllustration(root,true,'legacy');
  expect(material.customProgramCacheKey()).toBe(classicKey);
  setCharacterIllustration(root,false);
  expect(material.customProgramCacheKey()).toBe(initialKey);
  expect(material.onBeforeCompile).toBe(initialCompile);
  expect(material.toneMapped).toBe(true);
  expect(mesh.geometry).toBe(originalGeometry);
  geometry.dispose();material.dispose();
 });
 it('is only a device preference and leaves current avatar, 29 original seat registrations and homes untouched',()=>{
  const source=readFileSync('apps/room3d/editor.js','utf8');
  expect(source).toContain('data-action="character-style"');
  expect(source).toContain("setCharacterStyle(d.value==='legacy'?'legacy':d.value==='illustrated'?'illustrated':'modern')");
  expect(source).toContain("['illustrated','手绘线稿 · 梦核电影感']");
  expect(source).not.toContain('state.characterStyle=');
  setCharacterStyle('legacy');
  expect(getCharacterStyle()).toBe('legacy');
  setCharacterStyle('illustrated');
  expect(getCharacterStyle()).toBe('illustrated');
  setCharacterStyle('modern');
  expect(getCharacterStyle()).toBe('modern');
 });
});
