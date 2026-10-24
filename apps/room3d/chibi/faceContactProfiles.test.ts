import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {lipWorld} from './headContactIK';
import {faceContactWorld,faceContactError,faceContactEnvelope,faceContactRecipes} from './faceContactProfiles';

function actor(headSize=1,bodyHeight=1):ChibiVisitor{
 const root=new T.Group(),head=new T.Bone();
 head.position.set(0,2,0);root.add(head);root.position.set(.5,0,-.2);
 root.updateWorldMatrix(true,true);
 const inverse=new T.Matrix4().makeTranslation(0,-2,0);
 return {root,rig:{
  bones:{head},bodyHeight,
  mesh:{geometry:{userData:{headSize}}},
  skeleton:{bones:[head],boneInverses:[inverse]},
 }} as unknown as ChibiVisitor;
}
describe('future reusable face contact anchors',()=>{
 it('retains the existing, approved mouth locator exactly',()=>{
  const resident=actor(1.2,.85),mouth=faceContactWorld(resident,'mouth');
  expect(mouth).not.toBeNull();
  expect(mouth!.distanceTo(lipWorld(resident))).toBeLessThan(1e-10);
 });
 it('transforms anchors with the head, reuses cached locals and responds to proportions',()=>{
  const resident=actor(),before=faceContactWorld(resident,'forehead')!;
  const again=faceContactWorld(resident,'forehead')!;
  expect(before.distanceTo(again)).toBe(0);
  resident.rig!.bones.head.rotation.y=.3;
  const turned=faceContactWorld(resident,'forehead')!;
  expect(before.distanceTo(turned)).toBeGreaterThan(.001);
  resident.rig!.mesh.geometry.userData.headSize=1.3;
  const resized=faceContactWorld(resident,'forehead')!;
  expect(turned.distanceTo(resized)).toBeGreaterThan(.001);
 });
 it('supports forehead, nose and both cheeks without enabling new actions',()=>{
  const resident=actor();
  const left=faceContactWorld(resident,'leftCheek')!,right=faceContactWorld(resident,'rightCheek')!;
  expect(left.x).toBeLessThan(right.x);
  expect(faceContactWorld(resident,'nose')!.z).toBeGreaterThan(faceContactWorld(resident,'forehead')!.z);
  expect(Object.keys(faceContactRecipes).sort()).toEqual(['cheekKissLeft','cheekKissRight','foreheadKiss','foreheadTouch','noseTouch']);
 });
 it('does not solve IK or report contact on rigs without head bones',()=>{
  const resident=actor(),classic={root:new T.Group(),rig:null} as unknown as ChibiVisitor;
  expect(faceContactWorld(classic,'forehead')).toBeNull();
  expect(faceContactError(classic,resident,faceContactRecipes.foreheadTouch)).toBeNull();
  expect(faceContactError(resident,resident,faceContactRecipes.foreheadTouch)?.reached).toBe(true);
 });
 it('supports configurable entrance/exit without a new per-frame controller',()=>{
  const recipe={...faceContactRecipes.foreheadTouch,exit:[.8,1] as const};
  expect(faceContactEnvelope(recipe,-1)).toBe(0);
  expect(faceContactEnvelope(recipe,.4)).toBe(1);
  expect(faceContactEnvelope(recipe,1.1)).toBe(0);
  expect(faceContactEnvelope(recipe,NaN)).toBe(0);
 });
});
