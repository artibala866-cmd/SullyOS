import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import catalog from '../../public/room3d/catalog.json';
import {createHome,validateHome} from './model.js';
import {addActivityRoom} from './activityRooms.js';
import {homeMap} from './homeMap.js';

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
 it('shows the Halloween creation/enter action on the formal-home room list',()=>{
  const source=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  const formalRoomAction=source.split('\n').find(line=>line.startsWith("  if(onMenu&&panel==='rooms')sheet+="));
  expect(formalRoomAction).toContain('data-action="activity-room"');
  expect(formalRoomAction).toContain('创建万圣节魔法小屋');
  expect(formalRoomAction).toContain('前往万圣节魔法小屋');
  // Activity annex is a prepared theme, not a user's manual five-tile extension.
  expect(source).toMatch(/if\(d\.action==='activity-room'\)[\s\S]*?\{templateUpgrade:true\}/);
  expect(source).toContain("confirmResourcePack('halloween-furniture',abort.signal)");
 });

 it('exposes the Halloween house on the live home map without squeezing the six base rooms',()=>{
  const home=createHome(catalog),seed=home.rooms[0];
  home.rooms=['客厅','卫生间','厨房','卧室','书房','空房'].map((name,i)=>({
   ...structuredClone(seed),id:'room-'+i,name,x:[0,1,2,0,1,0][i],z:0,level:[0,0,0,1,1,2][i],items:[]
  }));
  home.activeRoomId='room-4';
  const before=homeMap(home,'room-4');
  expect(before).toContain('开放万圣节小屋');
  expect(before).toContain('data-action="activity-room"');
  expect(before.match(/data-action="room"/g)).toHaveLength(6);
  expect(before).toContain('grid-template-columns:repeat(6,minmax(0,1fr))');
  const oldRooms=structuredClone(home.rooms);
  const annex=addActivityRoom(home,'halloween',catalog);
  const after=homeMap(home,'room-4');
  expect(home.rooms.slice(0,6)).toEqual(oldRooms);
  expect(annex.items).toHaveLength(12);
  expect(after).toContain('前往万圣节魔法小屋');
  expect(after).toContain('7 · 万圣节魔法小屋');
  expect(after.match(/data-action="room"/g)).toHaveLength(6);
  expect(after).toContain('grid-template-columns:repeat(6,minmax(0,1fr))');
  expect(after).not.toContain('开放万圣节小屋');
  expect(homeMap(home,'room-4',true)).not.toContain('data-action="activity-room"');
 });

});
