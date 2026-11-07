import type { SpriteConfig } from '../types';

export type DateSpriteOrientation = 'portrait' | 'landscape';

export const DEFAULT_DATE_SPRITE_CONFIG: SpriteConfig = { scale: 1, x: 0, y: 0 };

/** Existing spriteConfig is always the portrait setup. Do not reuse its x/y
 * in landscape: those percentages are relative to a different image stage. */
export function initialDateLandscapeSpriteConfig(portrait?: SpriteConfig): SpriteConfig {
  const scale = portrait?.scale;
  return { scale: typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : 1, x: 0, y: 0 };
}

export function resolveDateSpriteConfig(
  orientation: DateSpriteOrientation,
  portrait?: SpriteConfig,
  landscape?: SpriteConfig,
): SpriteConfig {
  if (orientation === 'landscape') return landscape ?? initialDateLandscapeSpriteConfig(portrait);
  return portrait ?? DEFAULT_DATE_SPRITE_CONFIG;
}

/** Match the actual mobile landscape stage, not the visual viewport after
 * Android's IME opens (the IME must not switch the saved portrait/landscape setup). */
/** Keep the 0.5–2.0 Meet size slider effective in landscape. Only cap an
 * out-of-range legacy/imported zoom above 2 so the head stays on screen. */
export function dateLandscapeSpriteFit(scale: number): number {
  return Number.isFinite(scale) && scale > 2 ? 2 / scale : 1;
}

export function isDateMobileLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: landscape) and (min-width: 600px) and (max-height: 760px)').matches;
  }
  return window.innerWidth >= 600 && window.innerWidth > window.innerHeight && window.innerHeight <= 760;
}
