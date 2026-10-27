import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import catalog from '../../public/room3d/catalog.json';

// This guards the list of real Chromium/WebGL entry+exit scenarios. It does
// NOT turn a browser state-machine pass into body contact/IK visual approval.
describe('all authored seat types retain an executable WebGL smoke scenario',()=>{
 const script=readFileSync(new URL('../../test/home3d-smoke.html',import.meta.url),'utf8');
 it('enumerates every catalog asset with authored seat points',()=>{
  const segments=[...script.matchAll(/for\(const assetId of (\[[\s\S]*?\])\)\{/g)];
  expect(segments.length).toBeGreaterThanOrEqual(3);
  const names=new Set(['chair']);
  for(const [,_group,array] of segments.map(x=>[x[0],x[1],x[1]]))
   for(const [,id] of array.matchAll(/'([a-z][a-z0-9_]*)'/g))names.add(id);
  const expected=catalog.filter(a=>a.seats?.length).map(a=>a.id);
  expect([...names].sort()).toEqual(expected.sort());
  expect(expected.reduce((total,id)=>total+catalog.find(a=>a.id===id).seats.length,0)).toBe(29);
 });
 it('uses live Home3D controller input and verifies released seats after standing',()=>{
  expect(script).toContain('await mountHomeEditor(');
  expect(script).toContain("editor.performHomeAction(option.id,'model')");
  expect(script).toContain("editor.advancePets(18)");
  expect(script).toContain('if(editor.inspect().chibiSeat||editor.inspect().seatChange)');
  expect(script).toContain('occupiedTemplateRejected');
  expect(script).toContain('layoutHistory.preserved');
 });
});
