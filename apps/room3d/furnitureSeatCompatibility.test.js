import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {gamingPreset,gamingActivities} from './gaming.js';
import {seatTransform,roomSeats} from './seating.js';

describe('device interactions reuse compatible seat geometry',()=>{
 it('uses a physically aligned dining chair for computer and stream without changing the animation',()=>{
  const items=gamingPreset('computer',catalog),room={id:'r',items};
  const original=items.find(i=>i.assetId==='gaming_chair');
  const first=roomSeats(room,catalog).find(s=>s.itemId===original.id);
  const firstPose=seatTransform(room,catalog,first);
  const dining=catalog.find(a=>a.id==='dining_chair').seats[0].position;
  // The alternate seat anchor (not the model's box centre) must coincide with the
  // old contact point. Both chair assets face 180 degrees in the preset.
  original.assetId='dining_chair';
  original.x=firstPose.position[0]+dining[0];
  original.z=firstPose.position[2]+dining[2];
  const activities=gamingActivities(room,catalog).filter(a=>a.kind==='computer'||a.kind==='stream');
  expect(activities.map(a=>a.kind)).toEqual(['computer','stream']);
  expect(activities.every(a=>a.seat?.itemId===original.id)).toBe(true);
  expect(activities.every(a=>!a.reason)).toBe(true);
 });
 it('does not attach a low flower pouf to a workstation when the height is incompatible',()=>{
  const items=gamingPreset('computer',catalog),room={id:'r',items},chair=items.find(i=>i.assetId==='gaming_chair');
  const first=roomSeats(room,catalog).find(s=>s.itemId===chair.id),pose=seatTransform(room,catalog,first);
  chair.assetId='pouf';chair.x=pose.position[0];chair.z=pose.position[2];
  const activities=gamingActivities(room,catalog).filter(a=>a.kind==='computer');
  expect(activities[0].seat).toBeNull();
  expect(activities[0].reason).toMatch(/座椅/);
 });
});
