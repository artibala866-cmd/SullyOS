/** 见面模式的五种可配置背景，和人物立绘表情互不干扰。 */
export const DATE_SCENES = [
    { key: 'outdoor', label: '室外' },
    { key: 'bedroom', label: '卧室' },
    { key: 'bathroom', label: '浴室' },
    { key: 'kitchen', label: '厨房' },
    { key: 'work', label: '工作' },
] as const;
export type DateSceneKey = typeof DATE_SCENES[number]['key'];
export type DateSceneBackgrounds = Partial<Record<DateSceneKey, string>>;
export const configuredDateScenes = (backgrounds?: DateSceneBackgrounds) =>
    DATE_SCENES.filter(item => Boolean(backgrounds?.[item.key]));
/** 抽出独立的 [scene:xxx] 控制标签；不动 [happy] 或 [v:calm]。 */
export function extractDateSceneTag(line: string): { rest: string; scene?: DateSceneKey } {
    let scene: DateSceneKey | undefined;
    const rest = line.replace(/\[scene:\s*([a-z0-9_-]+)\s*\]/gi, (_match, value: string) => {
        const key = value.toLowerCase();
        // 不认识的控制标签也不应泄漏进台词/旁白，但绝不能触发换景。
        if (!DATE_SCENES.some(item => item.key === key)) return '';
        scene = key as DateSceneKey;
        return '';
    });
    return { rest: rest.trim(), scene };
}

/** Hide machine-only location controls on the pre-encounter sensing page.
 * Preserve the original peekStatus for saving and scene switching. */
export function stripDateSceneTagsForDisplay(text: string): string {
    return (text || '').split(/\r?\n/).map(line => {
        const parsed = extractDateSceneTag(line);
        return { raw: line, visible: parsed.rest };
    }).filter(({ raw, visible }) => visible.length > 0 || raw.trim() === '')
      .map(({ visible }) => visible)
      .join('\n').trim();
}
