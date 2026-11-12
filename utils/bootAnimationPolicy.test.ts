import { describe, expect, it, vi } from 'vitest';
import { persistBootAnimationPreference, shouldShowBootSequence } from './bootAnimationPolicy';

describe('boot animation hard off', () => {
  it('does not mount before saved theme hydration, even with default enabled state', () => {
    expect(shouldShowBootSequence(false, undefined, false)).toBe(false);
    expect(shouldShowBootSequence(false, true, false)).toBe(false);
  });
  it('honors disabled setting on every cold launch and never replays after completion', () => {
    expect(shouldShowBootSequence(true, false, false)).toBe(false);
    expect(shouldShowBootSequence(true, false, true)).toBe(false);
    expect(shouldShowBootSequence(true, true, true)).toBe(false);
    expect(shouldShowBootSequence(true, true, false)).toBe(true);
  });
  it('writes off preference immediately without erasing wallpaper and other theme choices', () => {
    let stored = JSON.stringify({ wallpaper: 'custom-wallpaper', darkMode: true, bootAnimationEnabled: true });
    const storage = { getItem: vi.fn(() => stored), setItem: vi.fn((_key: string, value: string) => { stored = value; }) };
    persistBootAnimationPreference(storage, false);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stored)).toEqual({ wallpaper: 'custom-wallpaper', darkMode: true, bootAnimationEnabled: false });
    persistBootAnimationPreference(storage, true);
    expect(JSON.parse(stored).bootAnimationEnabled).toBe(true);
  });
  it('does not silently claim the off choice succeeded when storage fails', () => {
    expect(() => persistBootAnimationPreference({
      getItem: () => '{}',
      setItem: () => { throw Error('QuotaExceededError'); },
    }, false)).toThrow('QuotaExceededError');
  });
});
