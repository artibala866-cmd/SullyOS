// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const desktop=readFileSync(new URL('../components/chat/CharacterPhoneDesktop.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../components/chat/characterPhoneHome.css',import.meta.url),'utf8');
const phone=readFileSync(new URL('../components/chat/CharacterPhone.tsx',import.meta.url),'utf8');
describe('Char phone P1 responsive desktop layout regression',()=>{
 it('does not scale the desktop with browser zoom or inverse width',()=>{
  expect(phone).not.toMatch(/zoom:\s*homeZoom/);
  expect(phone).not.toMatch(/100\s*\/\s*homeZoom/);
  expect(phone).not.toMatch(/setHomeZoom/);
  expect(desktop).toContain('className="cp-home-wallpaper"');
  expect(css).toContain('container: char-phone-desktop / size');
  expect(css).toContain('grid-template-rows');
  expect(css).toContain('@container char-phone-desktop (max-height: 545px)');
 });
 it('keeps reference-order components, full dock and the swipeable second page',()=>{
  const homepage=desktop.split('export function CharacterPhoneHome')[1].split('export function CharacterPhoneBeautify')[0];
  const ordered=['cp-home-topwidgets','cp-home-quote','cp-home-middle','cp-home-decoration','cp-home-pages','cp-home-dock'];
  expect(ordered.map(mark=>homepage.indexOf(mark)).every((n,i,list)=>n>=0&&(i===0||n>list[i-1]))).toBe(true);
  for(const app of ['微信','备忘录','浏览器','美化','电话','短信','相册'])expect(homepage).toContain('label="'+app+'"');
  expect(homepage).toContain('page===0?');
  expect(homepage).toContain("gridRow:'1 / -1'");
 });
 it('reserves real room for the dock and adapts short phone heights',()=>{
  expect(css).toMatch(/\.cp-home-dock\s*\{[^}]*flex:\s*0 0 clamp\(/s);
  expect(css).toContain('@container char-phone-desktop (max-height: 435px)');
  expect(css).toContain('.cp-home-polaroid--right');
  expect(css).not.toMatch(/\.cp-home-wallpaper[^}]*zoom:/s);
 });
});
