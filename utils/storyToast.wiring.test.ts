import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../components/date/story/StoryTheaterSession.tsx', import.meta.url)), 'utf8');
const context = readFileSync(fileURLToPath(new URL('../context/OSContext.tsx', import.meta.url)), 'utf8');

describe('剧情生成时防止长按提示刷屏', () => {
    it('只有真正长按超过阈值才弹修改限制提示，轻触和滑动不触发', () => {
        const start = source.indexOf('const beginLongPress = useCallback');
        const end = source.indexOf('const moveLongPress = useCallback', start);
        expect(start).toBeGreaterThan(-1);
        const section = source.slice(start, end);
        const timer = section.indexOf('longPressTimer.current = setTimeout(() => {');
        const notification = section.indexOf("addToast('剧情正在后台生成，请完成后再修改楼层'");
        const pointerFilter = section.indexOf("closest('button, a, input, textarea, select, summary')");
        expect(pointerFilter).toBeGreaterThan(-1);
        expect(timer).toBeGreaterThan(pointerFilter);
        expect(notification).toBeGreaterThan(timer);
        expect(section).toContain('}, 520);');
        expect(source).toContain('onPointerMove: moveLongPress');
        expect(source).toContain('onPointerCancel: cancelLongPress');
    });

    it('OSContext 使用单条序列派发，不再直接把全部提示追加到数组', () => {
        expect(context).toContain('createToastSequencer(setToasts)');
        expect(context).toContain('toastSequencerRef.current?.enqueue(message, type)');
        expect(context).not.toContain('setToasts(prev => [...prev, { id, message, type }])');
    });
});
