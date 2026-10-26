import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {registeredFurnitureCapabilities} from './furnitureCapabilityRegistry.js';

// kit.glb is 4.5MB and its tiny original objects are exported from this
// reproducible Blender source. This checks authored-geometry calculations only:
// it is NOT a rendered mesh, animation, collision or character-scale QA result.
const source=readFileSync(new URL('../../art/jellyfish-home/build.py',import.meta.url),'utf8');
const asset=id=>catalog.find(a=>a.id===id);
describe('legacy kit source geometry and contact candidates',()=>{
 it('keeps the wood-chair seat at the actual top face with its back behind the character',()=>{
  expect(source).toContain("box('Chair soft seat',(-1.17,.87,.64),(.56,.50,.15)");
  expect(source).toContain("box('Chair curved back',(-1.17,.67,1.10)");
  const seat=asset('chair').seats[0];
  // Blender Z-up top: .64+.15/2=.715; original leg-foot datum .17.
  expect(seat.position[1]).toBeCloseTo(.715-.17,3);
  expect(seat.rotation).toBe(180); // chair front is Blender +Y => game -Z
  expect(registeredFurnitureCapabilities(asset('chair')).map(c=>c.kind)).toContain('sit');
 });
 it('contacts the pouf flower centre rather than an arbitrary bbox centre',()=>{
  expect(source).toContain("ellipsoid('Pouf petal',(1.54+.25*cos(a),-1.74+.25*sin(a),.36),(.22,.22,.20)");
  expect(source).toContain("ellipsoid('Pouf center',(1.54,-1.74,.40),(.19,.19,.15)");
  const seat=asset('pouf').seats[0];
  // Centre top .40+.15=.55, petal bottom .36-.20=.16.
  expect(seat.position[1]).toBeCloseTo(.55-.16,3);
  expect(seat.position.slice(0,1).concat(seat.position.slice(2))).toEqual([0,0]);
 });
 it('does not claim the whale loft has a safe bed entry while stairs and railing remain unvalidated',()=>{
  expect(source).toContain("box('Plump cream mattress'");
  expect(source).toContain("box('Wide low stair %02d'");
  expect(registeredFurnitureCapabilities(asset('loft')).some(c=>c.kind==='bed')).toBe(false);
 });
});
