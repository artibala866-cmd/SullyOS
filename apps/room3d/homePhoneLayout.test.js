import {describe,expect,it} from 'vitest';
import {shouldMoveHomePhoneLauncherLeft} from './homePhoneLayout.js';

const container={left:0,top:0,right:390,bottom:844};
const launcher={width:76,height:100};
const rect=(left,top,width=48,height=48)=>({left,top,right:left+width,bottom:top+height});

describe('home phone launcher avoids resident portraits',()=>{
 it('keeps the right-side position when portraits are above the launcher',()=>{
  expect(shouldMoveHomePhoneLauncherLeft({container,launcher,residentRects:[rect(330,130),rect(330,192)]})).toBe(false);
 });
 it('moves to the opposite side when the right-side launcher would cover a portrait',()=>{
  expect(shouldMoveHomePhoneLauncherLeft({container,launcher,residentRects:[rect(320,600)]})).toBe(true);
 });
 it('reserves a small gap around the portrait instead of allowing near-touching overlap',()=>{
  expect(shouldMoveHomePhoneLauncherLeft({container,launcher,residentRects:[rect(320,584)]})).toBe(true);
 });
 it('does not move when the portrait is outside the launcher horizontal area',()=>{
  expect(shouldMoveHomePhoneLauncherLeft({container,launcher,residentRects:[rect(80,600)]})).toBe(false);
 });
});
