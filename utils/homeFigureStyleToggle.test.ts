// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it} from 'vitest';
import {CharacterStyleToggle} from '../experiments/chibi/CharacterStyleToggle';
import {getCharacterStyle,setCharacterStyle,CHARACTER_STYLE_KEY} from '../apps/room3d/chibi/characterStyle';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:ReturnType<typeof createRoot>|undefined;
afterEach(()=>{if(root){act(()=>root!.unmount());root=undefined;}setCharacterStyle('modern');localStorage.clear();});
it('visibly switches modern/legacy figures, persists choice, and uses the existing renderer subscription',()=>{
 setCharacterStyle('modern');const host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 try{
  act(()=>root!.render(React.createElement(CharacterStyleToggle)));
  const modern=host.querySelector<HTMLButtonElement>('[aria-label="现代画风"]')!,legacy=host.querySelector<HTMLButtonElement>('[aria-label="经典画风"]')!;
  expect(modern.getAttribute('aria-pressed')).toBe('true');
  act(()=>legacy.click());
  expect(getCharacterStyle()).toBe('legacy');
  expect(localStorage.getItem(CHARACTER_STYLE_KEY)).toBe('legacy');
  expect(legacy.getAttribute('aria-pressed')).toBe('true');
  act(()=>modern.click());
  expect(getCharacterStyle()).toBe('modern');
  expect(modern.getAttribute('aria-pressed')).toBe('true');
 }finally{act(()=>root!.unmount());root=undefined;host.remove();}
});
