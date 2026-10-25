import { describe, expect, it } from 'vitest';
import { roomPixelRatio } from './renderQuality.js';
import { createRoomFrameBudget } from './frameBudget.js';

describe('Mobile room rendering budget', () => {
  it('caps high-density phones without reducing the chosen quality tier on desktop', () => {
    expect(roomPixelRatio('clear', 3, true)).toBe(1.8);
    expect(roomPixelRatio('balanced', 3, true)).toBe(1.35);
    expect(roomPixelRatio('eco', 3, true)).toBe(1);
    expect(roomPixelRatio('clear', 1, false)).toBe(1.5);
    expect(roomPixelRatio('clear', 1, true)).toBe(1);
  });
  it('does not change resolution after one spike or when inactive', () => {
    const budget = createRoomFrameBudget({ enabled: true });
    expect(budget.observe({ now: 500, frameMs: 120 })).toBeNull();
    expect(budget.observe({ now: 600, frameMs: 120, active: false })).toBeNull();
    expect(budget.observe({ now: 1000, frameMs: 1000 })).toBeNull();
    expect(budget.scale).toBe(1);
  });
  it('reacts to repeated jank, then recovers after sustained smooth frames', () => {
    const budget = createRoomFrameBudget({ enabled: true });
    let change = null;
    for (let n=0; n<4; n++) change = budget.observe({ now: 400+n*70, frameMs: 65 });
    expect(change).toBe(.85);
    for (let n=0; n<4; n++) change = budget.observe({ now: 4200+n*70, frameMs: 65 });
    expect(change).toBe(.7);
    for (let n=0; n<120; n++) change = budget.observe({ now: 8100+n*33, frameMs: 33 });
    expect(change).toBe(.85);
    expect(budget.scale).toBe(.85);
    budget.reset();
    expect(budget.scale).toBe(1);
  });
  it('is inert on desktop even when frames are repeatedly slow', () => {
    const budget = createRoomFrameBudget({ enabled: false });
    for(let n=0;n<20;n++)expect(budget.observe({now:n*70,frameMs:70})).toBeNull();
    expect(budget.scale).toBe(1);
  });
});
