import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAY_LAUNCHER_BACKGROUND, resolveLauncherBackground } from './launcherWallpaper';

const systemDefault = 'radial-gradient(white, transparent), linear-gradient(#fafafa, #e9e9e9)';

describe('launcher wallpaper vs. original gray fallback', () => {
  it('uses the same gray desktop when wallpaper is unset or reset to system default', () => {
    expect(resolveLauncherBackground(undefined, systemDefault)).toBe(DEFAULT_GRAY_LAUNCHER_BACKGROUND);
    expect(resolveLauncherBackground('', systemDefault)).toBe(DEFAULT_GRAY_LAUNCHER_BACKGROUND);
    expect(resolveLauncherBackground(systemDefault, systemDefault)).toBe(DEFAULT_GRAY_LAUNCHER_BACKGROUND);
  });

  it('does not cover an uploaded wallpaper resolved from IndexedDB to an object URL', () => {
    expect(resolveLauncherBackground('blob:https://example.com/asset-1', systemDefault))
      .toBe('url("blob:https://example.com/asset-1") center / cover no-repeat');
  });

  it('renders network, local and data image wallpapers at full size', () => {
    for (const url of ['https://example.com/wall.png', '/themes/sully/wallpaper.webp', 'data:image/png;base64,AA==', '../wallpaper.png']) {
      expect(resolveLauncherBackground(url, systemDefault)).toBe(`url("${url}") center / cover no-repeat`);
    }
  });

  it('preserves user-selected gradients instead of substituting the fixed gray theme', () => {
    for (const value of ['linear-gradient(45deg, red, blue)', 'radial-gradient(circle, red, blue)', 'repeating-linear-gradient(red, blue)']) {
      expect(resolveLauncherBackground(value, systemDefault)).toBe(value);
    }
  });
});
