import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {furnitureInteractions} from './furnitureInteractions.js';
const item={id:'range',assetId:'kitchen_range',x:0,y:.15,z:0,rotation:0,stored:false};
describe('real kitchen access gates on interaction wheel',()=>{
 it('does not display a reachable action when its actual navigation plan is blocked',()=>{
  const room={id:'r',items:[item]};
  const options=furnitureInteractions(room,catalog,'range',{kitchenPlanner:()=>({reason:'炉灶前没有可以走到的操作点'})});
  const action=options.find(a=>a.action==='chibi-kitchen');
  expect(action.reason).toContain('没有可以走到');
  expect(furnitureInteractions(room,catalog,'range',{kitchenPlanner:()=>({kind:'cook',source:{}})}).find(a=>a.action==='chibi-kitchen').reason).toBe('');
 });
 it('preserves missing-dependency feedback even if a planner is supplied',()=>{
  const dishes={...item,id:'dishes',assetId:'kitchenware_plates'};
  const room={id:'r',items:[dishes]};
  let calls=0;
  const action=furnitureInteractions(room,catalog,'dishes',{kitchenPlanner:()=>{calls++;return {};}}).find(a=>a.action==='chibi-kitchen');
  expect(action.reason).toContain('水槽');
  expect(calls).toBe(0);
 });
});
