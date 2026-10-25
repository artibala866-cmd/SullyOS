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
 it('uses a narrow Android framed view or true edge-to-edge mode without zoom',()=>{
  expect(phone).toContain("w-[min(88vw,344px)]");
  expect(phone).toContain("h-[min(91dvh,780px)]");
  expect(phone).toContain("phoneAppearance.fullscreen");
  expect(phone).toContain("h-[100dvh] w-full");
  expect(phone).toContain("rounded-none border-0");
  expect(phone).toContain("env(safe-area-inset-top, 0px)");
  expect(phone).toContain("env(safe-area-inset-bottom, 0px)");
  expect(desktop).toContain('aria-label="查手机界面全屏"');
  expect(desktop).toContain('checked={appearance.fullscreen}');
  expect(desktop).toContain('patch({fullscreen:e.target.checked})');
 });
 it('fits the lock screen in either phone viewport without its own scrollbar',()=>{
  const lock=desktop.split('export function CharacterPhoneLockScreen')[1].split('export function CharacterPhoneHome')[0];
  expect(lock).toContain('className="cp-lock-wallpaper"');
  expect(lock).toContain('cp-lock-content');
  expect(lock).toContain('cp-lock-card');
  expect(lock).toContain('cp-lock-unlock');
  expect(lock).not.toContain('overflow-y-auto');
  expect(css).toContain('container: char-phone-lock / size');
  expect(css).toContain('@container char-phone-lock (max-height: 450px)');
  expect(css).toMatch(/\.cp-lock-unlock\s*\{[^}]*flex:\s*0 0 clamp\(/s);
 });
  it('reserves real room for the dock and adapts short phone heights',()=>{
  expect(css).toMatch(/\.cp-home-dock\s*\{[^}]*flex:\s*0 0 clamp\(/s);
  expect(css).toContain('@container char-phone-desktop (max-height: 435px)');
  expect(css).toContain('.cp-home-polaroid--right');
  expect(css).not.toMatch(/\.cp-home-wallpaper[^}]*zoom:/s);
 });
});
