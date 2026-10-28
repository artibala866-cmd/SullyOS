/** Pure viewport guard for automatic chat replies; no prompt, storage, or API effects. */
export function isChatKeyboardCovered(
    baselineHeight: number,
    viewportHeight: number,
    viewportOffsetTop = 0,
): boolean {
    const visibleBottom = viewportHeight + Math.max(0, viewportOffsetTop);
    return Number.isFinite(baselineHeight) && baselineHeight > 0
        && Number.isFinite(visibleBottom) && visibleBottom > 0
        && baselineHeight - visibleBottom > 140;
}
