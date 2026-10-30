import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {selectedMotions,sampleSelected} from '../apps/room3d/chibi/selectedMotions';
import {isSeasonalSocial} from '../apps/room3d/chibi/seasonalSocial';
import {homeSocialActionAllowed} from '../apps/room3d/homeRomance';
import catalog from '../public/room3d/catalog.json';

describe('incremental forehead-touch motion without legacy regressions',()=>{
 const motion=selectedMotions.find(x=>x.id==='home-forehead-touch');
 it('adds one original two-person intimate action and preserves six local custom motions',()=>{
  expect(motion).toMatchObject({label:'贴额头',category:'close',participants:2,file:'home-forehead-touch.json'});
  expect(selectedMotions).toHaveLength(54);
  for(const id of ['home-rear-hug','home-hand-hold-plead','home-sofa-lap-pillow','home-head-pat','home-sneak-kiss','home-passion-kiss'])
   expect(selectedMotions.some(x=>x.id===id),id).toBe(true);
  expect(isSeasonalSocial('home-forehead-touch')).toBe(true);
  // User's existing kiss has a separate reviewed custom adapter: never reroute it.
  expect(isSeasonalSocial('home-kiss')).toBe(false);
 });
 it('requires the existing romantic-pair authorization',()=>{
  const empty={romanticPairs:[] as [string,string][]};
  expect(homeSocialActionAllowed(empty,'home-forehead-touch','a','b')).toBe(false);
  expect(homeSocialActionAllowed({romanticPairs:[['a','b']]},'home-forehead-touch','a','b')).toBe(true);
 });
 it('retains the prior 29 furnished seat anchors and 8 bed anchors',()=>{
  const old=catalog.filter(a=>!a.id.startsWith('halloween_'));
  expect(old.reduce((n,a)=>n+(a.seats?.length||0),0)).toBe(29);
  expect(old.reduce((n,a)=>n+(a.beds?.length||0),0)).toBe(8);
 });
 it('loads the original keyframe asset and samples both motion tracks',()=>{
  const file=JSON.parse(readFileSync('public/room3d/motions/selected/home-forehead-touch.json','utf8'));
  expect(file.version).toBe(1);
  expect(file.id).toBe('home-forehead-touch');
  expect(file.actors).toHaveLength(2);
  for(const actor of file.actors){
   expect(actor.times.length).toBeGreaterThan(5);
   const frame=sampleSelected(actor,Math.min(3,actor.duration));
   expect(frame.position.toArray().every(Number.isFinite)).toBe(true);
   expect(Object.values(frame.rotations).every(q=>q.toArray().every(Number.isFinite))).toBe(true);
  }
 });
});
