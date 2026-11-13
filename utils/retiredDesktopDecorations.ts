/** Remove the retired desktop sticker feature without touching any other theme fields. */
export function stripRetiredDesktopDecorations<T extends object>(theme: T): T {
  if (!theme || !Object.prototype.hasOwnProperty.call(theme, 'desktopDecorations')) return theme;
  const clean = { ...theme } as T & { desktopDecorations?: unknown };
  delete clean.desktopDecorations;
  return clean;
}

/** Historical saved/shared presets may contain the removed field. */
export function stripRetiredDecorationPreset<T extends { theme?: unknown }>(preset: T): T {
  if (!preset || typeof preset !== 'object' || !preset.theme || typeof preset.theme !== 'object') return preset;
  const cleanTheme = stripRetiredDesktopDecorations(preset.theme);
  return cleanTheme === preset.theme ? preset : ({ ...preset, theme: cleanTheme } as T);
}

/** This IndexedDB namespace belonged exclusively to the retired desktop sticker DIY. */
export const isRetiredDecorationAssetId = (id: string): boolean => id.startsWith('deco_');
