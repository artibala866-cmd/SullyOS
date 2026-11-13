/** 独立持久化桌面图片位置；底图与首页胶片不共享值。 */
export const LAUNCHER_WIDGET_SLOTS = ['tl', 'tr', 'wide', 'dsq', 'film1', 'film2', 'film3', 'film4'] as const;
export const LAUNCHER_FILM_SLOTS = ['film1', 'film2', 'film3', 'film4'] as const;
export type LauncherWidgetSlot = (typeof LAUNCHER_WIDGET_SLOTS)[number];

/** 修改一个槽位，不覆盖其它图片；移除最后一张返回 undefined。 */
export function withLauncherWidgetChange(
    current: Readonly<Record<string, string>> | undefined,
    slot: LauncherWidgetSlot,
    value?: string,
): Record<string, string> | undefined {
    const next = { ...(current || {}) };
    if (value) next[slot] = value;
    else delete next[slot];
    return Object.keys(next).length > 0 ? next : undefined;
}
