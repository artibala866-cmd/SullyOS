import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {roomFrameDeltas,createRoomFrameBudget,furnitureNeedsActiveFrames} from './frameBudget.js';

describe('Home3D clocks under slow rasterization',()=>{
 it('advances action/navigation at actual low-fps frame time, with safe physics steps',()=>{
  expect(roomFrameDeltas(16.67).activity).toBeCloseTo(.01667);
  expect(roomFrameDeltas(66.67).activity).toBeCloseTo(.06667);
  expect(roomFrameDeltas(100)).toEqual({simulation:.05,activity:.10});
  expect(roomFrameDeltas(250)).toEqual({simulation:.05,activity:.2});
 });
 it('rejects malformed time and safely bounds tab or GPU recovery stalls',()=>{
  for(const ms of [-100,NaN,Infinity,-Infinity])expect(roomFrameDeltas(ms)).toEqual({simulation:0,activity:0});
  expect(roomFrameDeltas(5000)).toEqual({simulation:.05,activity:.2});
  expect(roomFrameDeltas(0)).toEqual({simulation:0,activity:0});
 });
 it('only loops on finite activity transitions under reduced motion',()=>{
  expect(furnitureNeedsActiveFrames()).toBe(false);
  expect(furnitureNeedsActiveFrames({visitorActivity:{kind:'computer'}})).toBe(false);
  expect(furnitureNeedsActiveFrames({visitorActivity:{kind:'stream'}})).toBe(false);
  expect(furnitureNeedsActiveFrames({visitorActivity:{kind:'bath-soak'}})).toBe(true);
  expect(furnitureNeedsActiveFrames({visitorActivity:{kind:'computer',journey:{}}})).toBe(true);
  expect(furnitureNeedsActiveFrames({seatChange:{pose:'bed'}})).toBe(true);
  expect(furnitureNeedsActiveFrames({visitorPlant:{itemId:'p'}})).toBe(true);
  expect(furnitureNeedsActiveFrames({kitchenTask:{kind:'wash'}})).toBe(true);
 });
 it('keeps adaptive rendering separate from character rigs and physics',()=>{
  const budget=createRoomFrameBudget({enabled:true});
  expect(budget.scale).toBe(1);
  const code=readFileSync(new URL('./editor.js',import.meta.url),'utf8');
  expect(code).toContain('const {simulation:dt,activity:activityDt}=roomFrameDeltas(now-lastTick);');
  expect(code).toContain('if(!manual&&!document.hidden)elapsed+=activityDt;');
  expect(code).toContain('const furnitureLifecycleActive=furnitureNeedsActiveFrames({seatChange,visitorPlant,visitorActivity,kitchenTask});');
  // Both the rendering-frame eligibility and the scheduling continuation must
  // honor the lifecycle, independent of the reduce-motion system preference.
  expect(code.split('||furnitureLifecycleActive||!reducedMotion').length-1).toBe(2);
 });
});
