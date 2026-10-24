import {describe,expect,it} from 'vitest';
import * as T from 'three';
import type {ChibiVisitor} from './visitor';
import {hugBackSurface,hugOutsideTarget} from './hugArmClearance';

function makeVisitor(){
 const root=new T.Group(),chest=new T.Bone();
 root.add(chest);
 root.scale.setScalar(.53);
 root.rotation.y=.4;
 root.updateWorldMatrix(true,true);
 return {root,rig:{bones:{chest}}} as unknown as ChibiVisitor;
}
const measure=(point:T.Vector3)=>{
 const x=point.x/.56,y=(point.y+.10)/.74,z=point.z/.40;
 return Math.hypot(x,y,z);
};
describe('standing hug chest surface targets',()=>{
 it('keeps all four role/hand targets behind and outside the recipient',()=>{
  const visitor=makeVisitor(),chest=visitor.rig!.bones.chest;
  for(const role of [0,1])for(const side of ['L','R'] as const){
   const target=hugBackSurface(visitor,side,role);
   const local=chest.worldToLocal(target.clone());
   expect(local.z).toBeLessThan(0);
   expect(measure(local)).toBeGreaterThan(1.09);
  }
 });
 it('projects interior targets to the outside in posed, scaled bone space',()=>{
  const visitor=makeVisitor(),chest=visitor.rig!.bones.chest;
  const inner=chest.localToWorld(new T.Vector3(.11,-.14,-.07));
  const target=hugOutsideTarget(visitor,inner);
  expect(measure(chest.worldToLocal(target.clone()))).toBeGreaterThanOrEqual(1.09-1e-5);
  expect(Number.isFinite(target.length())).toBe(true);
 });
 it('handles the chest centre without an unbounded correction',()=>{
  const visitor=makeVisitor(),chest=visitor.rig!.bones.chest;
  const centre=chest.localToWorld(new T.Vector3(0,-.10,0));
  const target=hugOutsideTarget(visitor,centre);
  expect(measure(chest.worldToLocal(target.clone()))).toBeCloseTo(1.09,5);
  expect(target.length()).toBeLessThan(5);
 });
});
