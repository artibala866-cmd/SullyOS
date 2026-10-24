import {describe,expect,it} from 'vitest';
import {selectedMotions} from './selectedMotions';
import {motionCapabilities,motionCapabilityKeys} from './motionCapabilities';
import {motionContactProfiles,motionContactProfile,contactEnvelope} from './motionContactProfiles';

describe('reusable motion classification',()=>{
 it('keeps ten independent internal capabilities',()=>{
  expect(motionCapabilityKeys).toHaveLength(10);
  expect(new Set(motionCapabilityKeys).size).toBe(10);
  expect(motionCapabilities.handContact).toBeDefined();
  expect(motionCapabilities.armWrap).toBeDefined();
 });
 it('does not change or expand the selected motion menu',()=>{
  expect(selectedMotions).toHaveLength(43);
  const actions=new Set(selectedMotions.map(x=>x.id));
  for(const id of Object.keys(motionContactProfiles))expect(actions.has(id)).toBe(true);
  expect(motionContactProfile('home-hug')).toBeUndefined();
  expect(motionContactProfile('home-kiss')).toBeUndefined();
  expect(motionContactProfile('cmu-22_17')).toBeUndefined();
 });
 it('migrates only three hand pairs and five body touches',()=>{
  const all=Object.values(motionContactProfiles);
  expect(all.filter(x=>x.kind==='pairedHands')).toHaveLength(3);
  expect(all.filter(x=>x.kind==='bodyTouch')).toHaveLength(5);
  for(const profile of all){
   expect(profile.capabilities.every(x=>x in motionCapabilities)).toBe(true);
   if(profile.kind==='bodyTouch'){
    expect(profile.targetBones).toEqual(['L_upperArm','R_upperArm']);
    expect(profile.near).toBe(.47);
    expect(profile.far).toBe(.64);
   }
  }
 });
});
describe('authored paired contact windows',()=>{
 it('preserves twirl reach and hand curl',()=>{
  const profile=motionContactProfile('cmu-20_10');
  expect(profile?.kind).toBe('pairedHands');
  if(profile?.kind!=='pairedHands')return;
  expect(profile.curl).toBe(.38);
  expect(contactEnvelope(profile,.14)).toBe(0);
  expect(contactEnvelope(profile,.50)).toBeGreaterThan(0);
  expect(contactEnvelope(profile,.85)).toBe(1);
 });
 it('preserves grab reach window',()=>{
  const profile=motionContactProfile('cmu-18_03');
  if(profile?.kind!=='pairedHands')throw Error('Missing grab profile');
  expect(profile.curl).toBe(.45);
  expect(contactEnvelope(profile,.12)).toBe(0);
  expect(contactEnvelope(profile,.55)).toBe(1);
 });
 it('releases low-five before walking away',()=>{
  const profile=motionContactProfile('cmu-20_12');
  if(profile?.kind!=='pairedHands')throw Error('Missing low-five profile');
  expect(profile.curl).toBe(.12);
  expect(contactEnvelope(profile,.09)).toBe(0);
  expect(contactEnvelope(profile,.35)).toBe(1);
  expect(contactEnvelope(profile,.65)).toBe(1);
  expect(contactEnvelope(profile,1.1)).toBe(0);
  expect(contactEnvelope(profile,Number.NaN)).toBe(0);
 });
});
