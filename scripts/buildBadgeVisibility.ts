/** Build-time UI classification, not a GitHub default-branch or deploy setting. */
const RELEASE_UI_BRANCHES = new Set([
  'main',
  'master',
  'remove-checkphone-vrworld-lifesim',
]);

export function shouldShowBuildBadge(
  branch: string,
  env: { VITE_HIDE_BUILD_BADGE?: string; VITE_SHOW_BUILD_BADGE?: string },
): boolean {
  let visible = !RELEASE_UI_BRANCHES.has(branch);
  if (env.VITE_HIDE_BUILD_BADGE === '1') visible = false;
  if (env.VITE_SHOW_BUILD_BADGE === '1') visible = true;
  return visible;
}
