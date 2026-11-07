import { describe, expect, it } from 'vitest';
import { initialDateLandscapeSpriteConfig, resolveDateSpriteConfig } from './dateSpriteOrientation';

describe('Meet sprite position is independent by orientation', () => {
  it('keeps old portrait position and starts old landscape at a neutral offset', () => {
    const savedPortrait = { scale: 1.3, x: 15, y: -10 };
    expect(resolveDateSpriteConfig('portrait', savedPortrait)).toEqual(savedPortrait);
    expect(resolveDateSpriteConfig('landscape', savedPortrait)).toEqual({ scale: 1.3, x: 0, y: 0 });
    expect(savedPortrait).toEqual({ scale: 1.3, x: 15, y: -10 });
  });
  it('uses and preserves a separately saved landscape position', () => {
    const portrait = { scale: 1.3, x: 0, y: -10 };
    const landscape = { scale: 1.6, x: -20, y: 15 };
    expect(resolveDateSpriteConfig('landscape', portrait, landscape)).toEqual(landscape);
    expect(resolveDateSpriteConfig('portrait', portrait, landscape)).toEqual(portrait);
  });
  it('does not mutate or lose legacy data and accepts missing configs', () => {
    expect(initialDateLandscapeSpriteConfig()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(initialDateLandscapeSpriteConfig({ scale: Number.NaN, x: 40, y: -20 })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(resolveDateSpriteConfig('portrait')).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
