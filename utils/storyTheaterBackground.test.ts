import { describe, expect, it, vi } from 'vitest';
import { hasWebUpdateActivity } from './webUpdateSession';
import {
    getStoryGenerationSnapshot, isStoryGenerationRunning,
    observeStoryGenerations, startStoryBackgroundGeneration, subscribeStoryGeneration,
} from './storyTheaterBackground';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('剧情后台生成生命周期', () => {
    it('离开页面并退订监听后，原任务仍完成并保存，再进入可看到结果', async () => {
        const entryId = 'background-reenter';
        let finish!: () => void;
        const network = new Promise<void>(resolve => { finish = resolve; });
        let saved = '';
        let requests = 0;
        const seen: string[] = [];
        const unsubscribe = subscribeStoryGeneration(entryId, state => seen.push(state.stage));

        expect(startStoryBackgroundGeneration(entryId, async report => {
            requests++;
            report('正在等待模型返回');
            await network;
            saved = '完整剧情正文，包含最终一句';
            report('已保存到 IndexedDB');
        })).toBe(true);
        // Fast double-tap and a new screen instance cannot start a second request.
        expect(startStoryBackgroundGeneration(entryId, async () => { requests++; })).toBe(false);
        await flush();
        expect(requests).toBe(1);
        expect(isStoryGenerationRunning(entryId)).toBe(true);
        expect(hasWebUpdateActivity()).toBe(true);
        expect(seen).toContain('正在等待模型返回');

        // Simulates unmount of the submitting StoryTheaterSession.
        unsubscribe();
        const enteredLater: string[] = [];
        const leaveOtherApp = subscribeStoryGeneration(entryId, snapshot => enteredLater.push(snapshot.phase));
        expect(enteredLater).toContain('running');
        leaveOtherApp();

        finish();
        await flush();
        expect(saved).toBe('完整剧情正文，包含最终一句');
        expect(getStoryGenerationSnapshot(entryId)?.phase).toBe('completed');
        expect(isStoryGenerationRunning(entryId)).toBe(false);
        expect(hasWebUpdateActivity()).toBe(false);
        expect(requests).toBe(1);

        const afterReturn: string[] = [];
        const stop = subscribeStoryGeneration(entryId, snapshot => afterReturn.push(snapshot.phase));
        expect(afterReturn).toEqual(['completed']);
        stop();
    });

    it('不同剧情并行独立，失败后不会永久锁住，也不会假装完成', async () => {
        const first = 'background-failure';
        const second = 'background-independent';
        let rejectFirst!: (reason: Error) => void;
        let resolveSecond!: () => void;
        const pendingFirst = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
        const pendingSecond = new Promise<void>(resolve => { resolveSecond = resolve; });
        const observed: string[] = [];
        const stop = observeStoryGenerations(s => observed.push(s.entryId + ':' + s.phase));
        expect(startStoryBackgroundGeneration(first, () => pendingFirst)).toBe(true);
        expect(startStoryBackgroundGeneration(second, () => pendingSecond)).toBe(true);
        await flush();
        rejectFirst(new Error('上游断开'));
        resolveSecond();
        await flush();
        expect(getStoryGenerationSnapshot(first)?.phase).toBe('failed');
        expect(getStoryGenerationSnapshot(first)?.error).toContain('上游断开');
        expect(getStoryGenerationSnapshot(second)?.phase).toBe('completed');
        expect(observed).toContain(first + ':failed');
        expect(observed).toContain(second + ':completed');
        expect(isStoryGenerationRunning(first)).toBe(false);
        expect(startStoryBackgroundGeneration(first, async () => {})).toBe(true);
        await flush();
        expect(getStoryGenerationSnapshot(first)?.phase).toBe('completed');
        stop();
    });
    it('另一个标签页已持锁时，本页不会发出第二笔生成请求', async () => {
        vi.stubGlobal('navigator', { locks: { request: vi.fn((_name, _options, callback) => callback(null)) } });
        try {
            const execute = vi.fn(async () => {});
            const release = vi.fn();
            expect(startStoryBackgroundGeneration('background-cross-tab', execute, release)).toBe(true);
            await flush();
            expect(execute).not.toHaveBeenCalled();
            expect(release).toHaveBeenCalledOnce();
            expect(getStoryGenerationSnapshot('background-cross-tab')?.error).toContain('本页未发送请求');
            expect(isStoryGenerationRunning('background-cross-tab')).toBe(false);
        } finally {
            vi.unstubAllGlobals();
        }
    });

});
