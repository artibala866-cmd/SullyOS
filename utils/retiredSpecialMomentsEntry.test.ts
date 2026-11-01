import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const src=(p:string)=>readFileSync(resolve(__dirname,'..',p),'utf8');
describe('3D-only cabinet and retired sources',()=>{
 const cabinet=src('components/character/ChibiStudio.tsx');
 const home=src('components/character/HomeFigureStudio.tsx');
 const editor=src('components/character/HomeFigureEditor.tsx');
 const room=src('apps/RoomApp.tsx');
 const home3d=src('apps/room3d/Home3DView.tsx');
 const context=src('context/OSContext.tsx');
 it('cabinet shows only home3D and retains custom materials',()=>{
  expect(cabinet).toContain('chibiStudio?.home3D');
  expect(cabinet).toContain('HomeFigureStudio');
  expect(cabinet).toContain('CreatorPartsUploader');
  expect(cabinet).not.toMatch(/小小窝|特别时光|like520|specialMomentRecords|sprites\?\.chibi|chibiStudio\?\.room/);
  expect(home).toContain('home3D: value');
  expect(home).not.toMatch(/小小窝|特别时光|like520|userChibi|sprites\?\.chibi/);
  expect(editor).toContain("from './CreatorIframe'");
 });
 it('3D home DreamTheater remains and resident figures are 3D-only',()=>{
  expect(room).toContain('DreamTheater');
  expect(room).toContain('dreamOpen');
  expect(room).toContain('c.chibiStudio?.home3D?.state');
  expect(room).not.toMatch(/chibiStudio\?\.room|chibiStudio\?\.userChibi/);
  expect(home3d).toContain('const savedState=character?.chibiStudio?.home3D?.state;');
 });
 it('obsolete VR figure migration no longer recreates deleted slots',()=>{
  expect(context).not.toMatch(/migrateRetiredVr(User|Character)Figure/);
 });
});
