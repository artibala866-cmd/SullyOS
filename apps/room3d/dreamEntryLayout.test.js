import {describe,expect,it} from 'vitest';
import {findDreamEntryTop} from './dreamEntryLayout.js';

const shell={top:100,bottom:944};
const rect=(top,bottom)=>({top,bottom,left:330,right:378});

describe('dream entry placement',()=>{
 it('places the dream entry below the complete resident rail when space is available',()=>{
  expect(findDreamEntryTop({shell,rail:rect(182,330),blockedRects:[rect(230,278),rect(292,330)]})).toBe(242);
 });
 it('moves above the rail if the lower slot is occupied by another floating control',()=>{
  expect(findDreamEntryTop({shell,rail:rect(350,600),blockedRects:[rect(520,650)]})).toBe(190);
 });
 it('does not place the dream entry over the top bar or bottom dock',()=>{
  expect(findDreamEntryTop({shell,rail:rect(182,762),blockedRects:[rect(100,160),rect(800,944)]})).toBe(null);
 });
 it('waits instead of showing an entry when neither side of the rail has a safe slot',()=>{
  expect(findDreamEntryTop({shell,rail:rect(350,700),blockedRects:[rect(700,800),rect(150,300)]})).toBe(null);
 });
});
