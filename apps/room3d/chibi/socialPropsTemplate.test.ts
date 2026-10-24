import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {createSocialProp} from './socialProps';
function classic(parent:T.Group,x:number):ChibiVisitor{
 const root=new T.Group();parent.add(root);
 return {root,rig:null,classicPoint:()=>new T.Vector3(x,1,0)} as unknown as ChibiVisitor;
}
describe('template-specified transient props',()=>{
 it('creates and cleans up a future phone without hard-coded action IDs',()=>{
  const room=new T.Group(),actor=classic(room,2);
  const count=room.children.length;
  const prop=createSocialProp('future-phone',[actor],{kind:'phone',hand:'R'});
  expect(prop).not.toBeNull();
  expect(room.children.length).toBe(count+1);
  prop!.update(.5,2,1);
  prop!.dispose();
  expect(room.children.length).toBe(count);
 });
 it('uses authored cup handoff time and disposes temporary geometries',()=>{
  const room=new T.Group(),a=classic(room,1),b=classic(room,5),count=room.children.length;
  const prop=createSocialProp('future-cup',[a,b],{kind:'cup',handoffAt:1});
  expect(prop).not.toBeNull();
  const cup=room.children.find(o=>o.name==='social-water-cup');
  expect(cup).toBeDefined();
  prop!.update(.5,4,1);
  const left=cup!.position.x;
  prop!.update(1.5,4,1);
  const right=cup!.position.x;
  expect(right).toBeGreaterThan(left+2);
  prop!.dispose();expect(room.children.length).toBe(count);
 });
});
