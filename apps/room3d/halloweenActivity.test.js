import {describe,it,expect} from 'vitest';
import catalog from '../../public/room3d/catalog.json';
import {createHome,validateHome} from './model.js';
import {addActivityRoom} from './activityRooms.js';

describe('seasonal room retains Home3D layout and seat contracts',()=>{
 it('adds a separate editable Halloween room without changing any original room or authored seat',()=>{
  const home=createHome(catalog),original=structuredClone(home.rooms);
  const oldSeats=catalog.filter(a=>!a.id.startsWith('halloween_')).reduce((n,a)=>n+(a.seats?.length||0),0);
  const event=addActivityRoom(home,'halloween',catalog);
  expect(home.rooms.slice(0,original.length)).toEqual(original);
  expect(event.items).toHaveLength(12);
  expect(event.items.every(item=>item.assetId.startsWith('halloween_'))).toBe(true);
  expect(oldSeats).toBe(29);
  expect(validateHome(home,catalog).rooms.find(r=>r.id===event.id)?.items).toHaveLength(12);
 });
});
