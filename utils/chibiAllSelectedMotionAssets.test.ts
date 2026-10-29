import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {motionCategories,selectedMotions,sampleSelected,type SelectedClip} from '../apps/room3d/chibi/selectedMotions';

/** Asset-wide numeric regression, not a claim of visual acceptance. */
describe('every existing 3D motion clip loads and interpolates with finite bone poses',()=>{
 it('retains 49 legacy actions and 8 old categories, plus 4 Halloween actions in their own category',()=>{
  const legacy=selectedMotions.filter(x=>!x.id.startsWith('halloween-'));
  expect(legacy).toHaveLength(49);
  expect(selectedMotions.filter(x=>x.id.startsWith('halloween-'))).toHaveLength(4);
  expect(selectedMotions).toHaveLength(53);
  expect(Object.keys(motionCategories).filter(id=>id!=='mischief')).toHaveLength(8);
  expect(Object.keys(motionCategories)).toHaveLength(9);
  expect(motionCategories.mischief).toContain('万圣节');
  expect(new Set(selectedMotions.map(x=>x.id)).size).toBe(53);
  expect(new Set(selectedMotions.map(x=>x.category))).toEqual(new Set(Object.keys(motionCategories)));
 });
 for(const entry of selectedMotions){
  it(`samples intact authored clip ${entry.id}`,()=>{
   expect(entry.file).toMatch(/^[a-zA-Z0-9_-]+\.json$/);
   const clip=JSON.parse(readFileSync('public/room3d/motions/selected/'+entry.file,'utf8')) as SelectedClip;
   expect(clip.version).toBe(1);
   expect(clip.id).toBe(entry.id);
   expect(clip.duration).toBeGreaterThan(0);
   expect(clip.actors).toHaveLength(entry.participants);
   for(const actor of clip.actors){
    expect(actor.duration).toBeGreaterThan(0);
    expect(actor.times.length).toBeGreaterThanOrEqual(2);
    for(let i=1;i<actor.times.length;i++)expect(actor.times[i]).toBeGreaterThan(actor.times[i-1]);
    expect(actor.positions).toHaveLength(actor.times.length*3);
    for(const [name,rotations] of Object.entries(actor.tracks)){
     expect(name.length).toBeGreaterThan(0);
     expect(rotations).toHaveLength(actor.times.length*4);
     expect(rotations.every(Number.isFinite)).toBe(true);
    }
    for(const positions of Object.values(actor.points)){
     expect(positions).toHaveLength(actor.times.length*3);
     expect(positions.every(Number.isFinite)).toBe(true);
    }
    for(const time of [-1,0,actor.duration*.2,actor.duration*.5,actor.duration*.8,actor.duration,actor.duration+1]){
     const frame=sampleSelected(actor,time);
     expect(frame.position.toArray().every(Number.isFinite)).toBe(true);
     expect(Number.isFinite(frame.hipHeight)).toBe(true);
     for(const q of Object.values(frame.rotations)){
      expect([q.x,q.y,q.z,q.w].every(Number.isFinite)).toBe(true);
      expect(Math.abs(q.length()-1)).toBeLessThan(.002);
     }
     for(const p of Object.values(frame.points))expect(p.toArray().every(Number.isFinite)).toBe(true);
    }
   }
  });
 }
});
