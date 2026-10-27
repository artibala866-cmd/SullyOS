import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {occupiedFurnitureChange,activeFurnitureDependencyChange} from './furnitureStationRegistry.js';
import {seatTransform,roomSeats} from './seating.js';
import {readFileSync} from 'node:fs';

const room={id:'r',items:[
 {id:'seat',assetId:'sofa',x:0,y:.18,z:0,rotation:0,stored:false},
 {id:'other',assetId:'pouf',x:2.5,y:.18,z:1,rotation:0,stored:false}
]};
const home={rooms:[room]},seat=roomSeats(room,catalog).find(a=>a.itemId==='seat');
const changed=(f)=>{const next=structuredClone(home);f(next.rooms[0].items);return next;};
const issue=(next,occupants=[seat])=>occupiedFurnitureChange(home,next,catalog,occupants);
describe('occupied furniture and supported decoration layout safety',()=>{
 it('preserves current furniture when a completely unrelated object moves',()=>{
  expect(issue(changed(items=>{items[1].x+=.4;}))).toBe('');
  expect(issue(changed(items=>{items[0].x+=2;}),[])).toBe('');
 });
 it('rejects moving, rotating, storing, deleting or replacing the actual occupied item',()=>{
  expect(issue(changed(items=>{items[0].x+=.5;}))).toContain('先让人物');
  expect(issue(changed(items=>{items[0].rotation=45;}))).toContain('先让人物');
  expect(issue(changed(items=>{items[0].stored=true;}))).toContain('先让人物');
  expect(issue(changed(items=>{items.splice(0,1);}))).toContain('先让人物');
  expect(issue(changed(items=>{items[0].assetId='pouf';}))).toContain('先让人物');
 });
 it('does not let a placed statue cover the hips of an occupied cushion',()=>{
  const current=seatTransform(room,catalog,seat,true);
  const prop={id:'prop',assetId:'bedroom_ref_sleeping_cat',x:current.position[0],y:current.position[1],z:current.position[2],rotation:0,supportId:'seat',stored:false};
  const next=changed(items=>items.push(prop));
  expect(roomSeats(next.rooms[0],catalog).some(s=>s.seatId===seat.seatId&&s.itemId==='seat')).toBe(false);
  expect(seatTransform(next.rooms[0],catalog,seat,true)).toBeNull();
  expect(issue(next)).toContain('先让人物');
 });
 it('rejects a NEW nearby furniture collider even if the occupied sofa is unchanged',()=>{
  const pose=seatTransform(room,catalog,seat,true);
  const blocked={id:'new-close',assetId:'bookcase',x:pose.position[0],y:.18,
   z:pose.position[2]+.25,rotation:0,stored:false};
  const next=changed(items=>items.push(blocked));
  expect(issue(next)).toContain('碰到正在使用座位的人物');
  // A nearby rug is non-colliding decoration and must not lock editing.
  const rug={id:'new-rug',assetId:'rug',x:pose.position[0],y:.18,
   z:pose.position[2],rotation:0,stored:false};
  expect(issue(changed(items=>items.push(rug)))).toBe('');
 });
 it('locks occupied bed anchors too without hiding unrelated decoration',()=>{
  const bed={id:'b',assetId:'bedroom_single_bed',x:0,y:.18,z:0,rotation:0,stored:false};
  const before={rooms:[{id:'r',items:[bed]}]};
  const occupied={roomId:'r',itemId:'b',seatId:'center',bed:true};
  const moved=structuredClone(before);moved.rooms[0].items[0].rotation=90;
  expect(occupiedFurnitureChange(before,moved,catalog,[occupied])).toContain('先让人物');
 });
});

describe('ongoing furniture tasks remain on physically unchanged equipment',()=>{
 const before={rooms:[{id:'kitchen',items:[
  {id:'hob',assetId:'kitchen_range',x:0,y:.15,z:0,rotation:0,stored:false},
  {id:'sink',assetId:'kitchen_sink',x:2,y:.15,z:0,rotation:0,stored:false},
  {id:'plant',assetId:'monstera',x:-2,y:.15,z:0,rotation:0,stored:false},
 ]}]};
 const task={itemId:'hob',dependencies:['hob','sink']},plant={itemId:'plant'};
 const change=fn=>{const h=structuredClone(before);fn(h.rooms[0].items);return h;};
 it('blocks a relocated or removed kitchen dependency, including for multi-leg washing',()=>{
  expect(activeFurnitureDependencyChange(before,change(i=>i[1].x+=.4),[task])).toContain('先结束');
  expect(activeFurnitureDependencyChange(before,change(i=>i[0].stored=true),[task])).toContain('先结束');
 });
 it('allows unrelated furniture edits and material-only changes',()=>{
  expect(activeFurnitureDependencyChange(before,change(i=>i[2].x+=.3),[task])).toBe('');
  expect(activeFurnitureDependencyChange(before,change(i=>i[0].color='#ffffff'),[task])).toBe('');
 });
 it('prevents moving a target plant while it is being watered',()=>{
  expect(activeFurnitureDependencyChange(before,change(i=>i[2].rotation=90),[plant])).toContain('先结束');
 });
 it('never stops a kitchen or bath activity BEFORE validating the proposed edit',()=>{
  const code=readFileSync(new URL('./editor.js',import.meta.url),'utf8'),
   start=code.indexOf('function commit(mutator,'),end=code.indexOf('function applyColor(',start);
  const body=code.slice(start,end);
  expect(body).toContain('seatChange||visitorActivity?.bathJourney');
  expect(body.indexOf('const occupiedError=occupiedFurnitureChange')).toBeLessThan(body.indexOf('stopWalking();'));
  expect(body.indexOf('const runningError=activeFurnitureDependencyChange')).toBeLessThan(body.indexOf('stopWalking();'));
  expect(body.indexOf('const budgetError=phone')).toBeLessThan(body.indexOf('stopWalking();'));
 });

});
