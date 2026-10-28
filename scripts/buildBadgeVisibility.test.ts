import { describe, expect, it } from 'vitest';
import { shouldShowBuildBadge } from './buildBadgeVisibility';

describe('release-branch build badge and dev-debug gate', () => {
  it('hides debug controls on the sole deployed development/delivery branch', () => {
    expect(shouldShowBuildBadge('remove-checkphone-vrworld-lifesim', {})).toBe(false);
  });

  it('preserves previous main/master release behavior', () => {
    expect(shouldShowBuildBadge('main', {})).toBe(false);
    expect(shouldShowBuildBadge('master', {})).toBe(false);
  });

  it('keeps other feature and unknown branches clearly labelled as non-release', () => {
    expect(shouldShowBuildBadge('fix/my-experiment', {})).toBe(true);
    expect(shouldShowBuildBadge('unknown', {})).toBe(true);
  });

  it('retains explicit opt-in diagnostics and build-hide overrides', () => {
    expect(shouldShowBuildBadge('remove-checkphone-vrworld-lifesim', { VITE_SHOW_BUILD_BADGE: '1' })).toBe(true);
    expect(shouldShowBuildBadge('fix/my-experiment', { VITE_HIDE_BUILD_BADGE: '1' })).toBe(false);
    expect(shouldShowBuildBadge('remove-checkphone-vrworld-lifesim', {
      VITE_HIDE_BUILD_BADGE: '1',
      VITE_SHOW_BUILD_BADGE: '1',
    })).toBe(true);
  });
});
