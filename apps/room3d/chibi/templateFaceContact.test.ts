import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {applyTemplateFaceContact} from './templateFaceContact';

function doll(x:number):ChibiVisitor{
 const root=new T.Group(),neck=new T.Bone(),head=new T.Bone();
 neck.position.set(0,1.2,0);head.position.set(0,.3,0);
 root.add(neck);neck.add(head);root.position.set(x,0,0);
 root.updateWorldMatrix(true,true);
 const skeleton={bones:[neck,head],boneInverses:[
  neck.matrixWorld.clone().invert(),head.matrixWorld.clone().invert()
 ]};
 return {root,rig:{bones:{neck,head},skeleton,bodyHeight:1,mesh:{geometry:{userData:{headSize:1}}}}} as unknown as ChibiVisitor;
}
describe('reusable facial contact adapter',()=>{
 it('never activates before the configured entrance window',()=>{
  const a=doll(-.8),b=doll(.8),pos=a.root.position.clone();
  expect(applyTemplateFaceContact('noseTouch',[a,b],0,1)).toBe(false);
  expect(a.root.position.equals(pos)).toBe(true);
  expect(a.rig!.bones.head.quaternion.equals(new T.Quaternion())).toBe(true);
 });
 it('aims using head/neck bones without changing the navigation roots',()=>{
  const a=doll(-.8),b=doll(.8),aPos=a.root.position.clone(),bPos=b.root.position.clone();
  expect(applyTemplateFaceContact('foreheadTouch',[a,b],1,1)).toBe(true);
  expect(a.root.position.equals(aPos)).toBe(true);
  expect(b.root.position.equals(bPos)).toBe(true);
  expect(a.rig!.bones.head.quaternion.angleTo(new T.Quaternion())).toBeLessThan(.12);
 });
 it('does not claim contact when one actor has no anatomical rig',()=>{
  const classic={root:new T.Group(),rig:null} as unknown as ChibiVisitor;
  expect(applyTemplateFaceContact('foreheadKiss',[doll(0),classic],1,1)).toBe(false);
 });
});
