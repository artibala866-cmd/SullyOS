import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {setCharacterIllustration,setCharacterRoomLighting,setCharacterRoomTint} from '../apps/room3d/chibi/illustration';
import {getCharacterStyle,setCharacterStyle} from '../apps/room3d/chibi/characterStyle';
import {dreamcoreFocusStrength} from '../apps/room3d/roomFinishPass.js';
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
 it('keeps Joyce Comic-style ink sharp and never composites a shifted scene as fake depth of field',()=>{
  const pass=readFileSync('apps/room3d/roomFinishPass.js','utf8');
  const editor=readFileSync('apps/room3d/editor.js','utf8');
  expect(pass).toContain('colourDiscontinuity');
  expect(pass).toContain('vec3 leftInk=sceneColor(');
  expect(pass).toContain('c=mix(c,vec3(.075,.064,.100),inkWeight)');
  expect(pass).toContain('float paperMask=');
  expect(pass).toContain('vec3 colouredInk=');
  expect(pass).toContain('float inkWeight=outlineStrength*mix(.25,.44');
  expect(pass).toContain('float colouredEdge=outlineStrength*.185');
  expect(pass).toContain('float inkHalation=');
  expect(pass).toContain('float inkFilm=');
  const character=readFileSync('apps/room3d/chibi/illustration.ts','utf8');
  expect(character).toContain("inkCutoutEdge*.77");
  expect(character).toContain('float inkMeshStroke=1.-smoothstep(.065,.175+inkLineAA,inkViewDot)');
  expect(character).toContain("'-character-illustration-v21-'");
  expect(pass).toContain('float paperTooth=');
  // A neighbour can detect an edge but never contribute its displaced
  // source colour to the output: that produced four clear ghost copies.
  expect(pass).not.toMatch(/outOfFocus|focusStrength|focusCenter|softened/);
  expect(pass).not.toMatch(/c\s*=\s*mix\(c,\s*(?:softened|near)/);
  expect(pass).toContain('baseFinish&&!illustrated');
  expect(editor).not.toContain('focusCenter');
  expect(pass).toContain('beginScene()');
  expect(pass).toContain('depthOfField');
  expect(pass).toContain('sceneBuffer.depthTexture');
  expect(editor).toContain("['illustrated','手绘风梦核']");
  expect(editor).toContain('人物画风 · 手绘线条、柔和纸感和真实空间景深');
 });
 it('keeps an overview completely sharp and only fades in gentle DOF on deliberate zoom',()=>{
  const c=new T.OrthographicCamera(-1.45,1.45,2.9,-2.9,.1,200);
  c.zoom=1;
  expect(dreamcoreFocusStrength(c)).toBe(0); // actual portrait living-view h=5.8
  c.zoom=1.3;
  expect(dreamcoreFocusStrength(c)).toBe(0);
  c.zoom=1.6;
  const entering=dreamcoreFocusStrength(c);
  expect(entering).toBeGreaterThan(0);
  expect(entering).toBeLessThan(.5);
  c.zoom=2.75;
  expect(dreamcoreFocusStrength(c)).toBeGreaterThan(.99);
  expect(dreamcoreFocusStrength(c,{edit:true})).toBe(0);
  expect(dreamcoreFocusStrength(c,{overview:true})).toBe(0);
  expect(dreamcoreFocusStrength(c,{firstPerson:true})).toBe(0);
  c.zoom=1;
  c.top=16;c.bottom=-16; // full-room portrait overview
  c.zoom=5;
  expect(dreamcoreFocusStrength(c)).toBe(0);
  expect(dreamcoreFocusStrength(new T.PerspectiveCamera())).toBe(0);
  const pass=readFileSync('apps/room3d/roomFinishPass.js','utf8');
  const editor=readFileSync('apps/room3d/editor.js','utf8');
  expect(pass).toContain('depthOfField*.21');
  expect(pass).toContain('dreamcoreFocusStrength');
  expect(editor).toContain('const focusAmount=dreamcore?dreamcoreFocusStrength(camera');
  expect(editor).toContain('const sceneCaptured=dreamcore&&roomFinish.beginScene()');
 });
 it('is only a device preference and leaves current avatar, 29 original seat registrations and homes untouched',()=>{
  const source=readFileSync('apps/room3d/editor.js','utf8');
  expect(source).toContain('data-action="character-style"');
  expect(source).toContain("setCharacterStyle(d.value==='legacy'?'legacy':d.value==='illustrated'?'illustrated':'modern')");
  expect(source).toContain("['illustrated','手绘风梦核']");
  expect(source).not.toContain('state.characterStyle=');
  setCharacterStyle('legacy');
  expect(getCharacterStyle()).toBe('legacy');
  setCharacterStyle('illustrated');
  expect(getCharacterStyle()).toBe('illustrated');
  setCharacterStyle('modern');
  expect(getCharacterStyle()).toBe('modern');
 });
});
