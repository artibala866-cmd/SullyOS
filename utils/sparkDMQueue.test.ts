import { describe, expect, it } from 'vitest';
import { appendSparkDMUser, setSparkDMDelivery, recoverSparkInterruptedDMs, sparkDMHistoryThrough, appendSparkDMAnswer } from './sparkDMQueue';

describe('Spark queued private messages', () => {
    it('preserves two rapid sends and replies only to the corresponding queued message', () => {
        let state = appendSparkDMUser({}, 'stranger:1', '第一条', 'm1', 1);
        state = appendSparkDMUser(state, 'stranger:1', '第二条', 'm2', 2);
        expect(sparkDMHistoryThrough(state, 'stranger:1', 'm1').map(m => m.content)).toEqual(['第一条']);
        expect(sparkDMHistoryThrough(state, 'stranger:1', 'm2').map(m => m.content)).toEqual(['第一条', '第二条']);
        state = appendSparkDMAnswer(state, 'stranger:1', 'm1', '第一条回复', 3);
        expect(state['stranger:1']).toHaveLength(3);
        expect(state['stranger:1'][0].delivery).toBe('sent');
        state = appendSparkDMAnswer(state, 'stranger:1', 'm2', '第二条回复', 4);
        expect(state['stranger:1'].map(m => m.content)).toEqual(['第一条', '第二条', '第一条回复', '第二条回复']);
    });
    it('sees the previous AI reply while excluding future user sends', () => {
        let threads = appendSparkDMUser({}, 'friend', '先问一件事', 'm1', 1);
        threads = appendSparkDMUser(threads, 'friend', '再补充一句', 'm2', 2);
        threads = appendSparkDMUser(threads, 'friend', '未来才发出的消息', 'm3', 3);
        threads = appendSparkDMAnswer(threads, 'friend', 'm1', '第一条的回复', 4);
        expect(sparkDMHistoryThrough(threads, 'friend', 'm2').map(m => m.content))
            .toEqual(['先问一件事', '再补充一句', '第一条的回复']);
        expect(sparkDMHistoryThrough(threads, 'friend', 'm1').map(m => m.content))
            .toEqual(['先问一件事', '第一条的回复']);
    });
    it('retries an existing failed bubble in place without duplicating the user message', () => {
        let state = appendSparkDMUser({}, 'character:1', '你好', 'fixed-id', 1);
        state = setSparkDMDelivery(state, 'character:1', 'fixed-id', 'failed');
        expect(state['character:1']).toHaveLength(1);
        state = setSparkDMDelivery(state, 'character:1', 'fixed-id', 'pending');
        expect(appendSparkDMUser(state, 'character:1', '你好', 'fixed-id', 2)).toBe(state);
        state = appendSparkDMAnswer(state, 'character:1', 'fixed-id', '在呢', 3);
        expect(state['character:1']).toHaveLength(2);
        expect(state['character:1'][0].delivery).toBe('sent');
    });
    it('recovers interrupted sends as retryable failures without deleting history', () => {
        const original = appendSparkDMUser({}, 'old-handle', '留下的草稿私信', 'm1', 1);
        const recovered = recoverSparkInterruptedDMs(original);
        expect(recovered['old-handle'][0].delivery).toBe('failed');
        expect(recovered['old-handle'][0].content).toBe('留下的草稿私信');
        expect(recoverSparkInterruptedDMs(recovered)).toBe(recovered);
    });
    it('does not include a failed earlier send in subsequent AI reply context', () => {
        let state = appendSparkDMUser({}, 'key', '失败消息', 'm1', 1);
        state = setSparkDMDelivery(state, 'key', 'm1', 'failed');
        state = appendSparkDMUser(state, 'key', '新消息', 'm2', 2);
        expect(sparkDMHistoryThrough(state, 'key', 'm2').map(m => m.content)).toEqual(['新消息']);
    });
});
