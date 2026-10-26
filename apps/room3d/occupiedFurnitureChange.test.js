import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {occupiedFurnitureChange} from './furnitureStationRegistry.js';
import {seatTransform,roomSeats} from './seating.js';

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
 it('locks occupied bed anchors too without hiding unrelated decoration',()=>{
  const bed={id:'b',assetId:'bedroom_single_bed',x:0,y:.18,z:0,rotation:0,stored:false};
  const before={rooms:[{id:'r',items:[bed]}]};
  const occupied={roomId:'r',itemId:'b',seatId:'center',bed:true};
  const moved=structuredClone(before);moved.rooms[0].items[0].rotation=90;
  expect(occupiedFurnitureChange(before,moved,catalog,[occupied])).toContain('先让人物');
 });
});
