import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '../types';
import { createToastSequencer } from './toastSequencer';

afterEach(() => vi.useRealTimers());

describe('全局提示只显示一个，消失后才显示下一条', () => {
    it('连续点击同一楼层不会堆叠九条相同提示；提示消失后再次操作才重新显示', () => {
        vi.useFakeTimers();
        const frames: Toast[][] = [];
        const controller = createToastSequencer(visible => frames.push(visible), 3000, 180);
        const message = '剧情正在后台生成，请完成后再修改楼层';

        for (let i = 0; i < 9; i++) controller.enqueue(message, 'info');
        expect(frames).toHaveLength(1);
        expect(frames[0]).toHaveLength(1);
        expect(frames[0][0].message).toBe(message);

        vi.advanceTimersByTime(2999);
        controller.enqueue(message, 'info');
        expect(frames).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(frames.at(-1)).toEqual([]);
        controller.enqueue(message, 'info'); // still fading; no duplicate
        vi.advanceTimersByTime(180);
        expect(frames).toHaveLength(2);

        controller.enqueue(message, 'info'); // genuine new operation after dismissal
        expect(frames.at(-1)?.[0].message).toBe(message);
        expect(frames).toHaveLength(3);
        expect(frames[2][0].id).not.toBe(frames[0][0].id);
        controller.dispose();
    });

    it('不同内容排队，当前提示消散后下一条才出现；排队期间也不重复', () => {
        vi.useFakeTimers();
        const frames: Toast[][] = [];
        const controller = createToastSequencer(visible => frames.push(visible), 3000, 180);
        controller.enqueue('正在后台生成', 'info');
        for (let i = 0; i < 20; i++) controller.enqueue('网络错误', 'error');
        expect(frames.map(frame => frame.map(t => t.message))).toEqual([['正在后台生成']]);

        vi.advanceTimersByTime(3000);
        expect(frames.at(-1)).toEqual([]);
        vi.advanceTimersByTime(179);
        expect(frames.at(-1)).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(frames.at(-1)).toEqual([{ id: 'toast-2', message: '网络错误', type: 'error' }]);
        expect(frames).toHaveLength(3);

        vi.advanceTimersByTime(3180);
        expect(frames.at(-1)).toEqual([]);
        controller.dispose();
    });

    it('离开应用或卸载后清理定时器，不再弹出已排队的旧提示', () => {
        vi.useFakeTimers();
        const frames: Toast[][] = [];
        const controller = createToastSequencer(visible => frames.push(visible), 3000, 180);
        controller.enqueue('第一条');
        controller.enqueue('第二条');
        controller.dispose();
        vi.advanceTimersByTime(15000);
        expect(frames.map(frame => frame[0]?.message)).toEqual(['第一条']);
    });
});
