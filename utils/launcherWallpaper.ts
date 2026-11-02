/**
 * The grayscale gradient is the launcher's ORIGINAL empty-wallpaper appearance.
 * It must be a fallback only: a user-selected wallpaper always wins.
 */
export const DEFAULT_GRAY_LAUNCHER_BACKGROUND =
  'radial-gradient(ellipse at 12% 0%, #ffffff 0%, transparent 52%), radial-gradient(ellipse at 95% 80%, #c9c9c9 0%, transparent 58%), linear-gradient(150deg, #f7f7f7 0%, #e8e8e8 48%, #dadada 100%)';

/**
 * OSContext resolves uploaded blobref images to blob: URLs before rendering.
 * Do not write a hard-coded gradient over that result in Launcher.
 * CSS gradients remain CSS backgrounds; image URLs are scaled like a phone wallpaper.
 */
export function resolveLauncherBackground(wallpaper: string | undefined, defaultWallpaper: string): string {
  if (!wallpaper || wallpaper === defaultWallpaper) return DEFAULT_GRAY_LAUNCHER_BACKGROUND;

  const imageUrl = /^(?:https?:|data:|blob:|\/|\.\.?\/)/i.test(wallpaper);
  return imageUrl ? `url(${JSON.stringify(wallpaper)}) center / cover no-repeat` : wallpaper;
}
