// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatComposerWaitMs, setChatComposerActivity, waitForChatComposer } from './chatComposerActivity';

afterEach(() => { setChatComposerActivity('test', null); vi.useRealTimers(); });
describe('input-ended conversation gate', () => {
    it('holds a generated result across IME, draft and keyboard release without generating again', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        setChatComposerActivity('test', { hasDraft: false, composing: true, keyboardVisible: false, activityAt: Date.now() });
        const delivered = vi.fn();
        const wait = waitForChatComposer('test', controller.signal).then(delivered);
        await vi.advanceTimersByTimeAsync(100_000);
        expect(delivered).not.toHaveBeenCalled();
        setChatComposerActivity('test', { hasDraft: true, composing: false, keyboardVisible: false, activityAt: Date.now() });
        expect(chatComposerWaitMs('test')).toBe(Infinity);
        setChatComposerActivity('test', { hasDraft: false, composing: false, keyboardVisible: false, activityAt: Date.now() });
        await vi.advanceTimersByTimeAsync(2499);
        expect(delivered).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await wait;
        expect(delivered).toHaveBeenCalledTimes(1);
    });
    it('off immediately releases the wait as cancelled, even during composition', async () => {
        const controller = new AbortController();
        setChatComposerActivity('test', { hasDraft: false, composing: true, keyboardVisible: true, activityAt: Date.now() });
        const wait = waitForChatComposer('test', controller.signal);
        controller.abort();
        await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
    });
});
