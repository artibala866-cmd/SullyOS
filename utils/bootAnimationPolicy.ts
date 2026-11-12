/** Startup UI must not run from the temporary default theme before the saved switch is read. */
export const shouldShowBootSequence = (
  themeSettingsLoaded: boolean,
  bootAnimationEnabled: boolean | undefined,
  bootDone: boolean,
): boolean => themeSettingsLoaded && bootAnimationEnabled !== false && !bootDone;

/** Save only the boot switch; keep every other stored theme field untouched. */
export const persistBootAnimationPreference = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  enabled: boolean,
): void => {
  const parsed: unknown = JSON.parse(storage.getItem('os_theme') || '{}');
  const current = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  storage.setItem('os_theme', JSON.stringify({ ...current, bootAnimationEnabled: enabled }));
};
