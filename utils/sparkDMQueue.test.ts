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

describe('Spark API-saving private-message batching', () => {
    it('one request acknowledges multiple rapid messages to the same account with just one reply', async () => {
        const { takeSparkDMJobBatch, appendSparkDMBatchAnswer, sparkDMBatchHistory } = await import('./sparkDMQueue');
        let state = appendSparkDMUser({}, 'c1', '上午有空吗', 'first', 1);
        state = appendSparkDMUser(state, 'c1', '我想一起去公园', 'second', 2);
        const batch = takeSparkDMJobBatch([
            { key: 'c1', accountId: 'character:1', id: 'first' },
            { key: 'c1', accountId: 'character:1', id: 'second' },
        ]);
        expect(batch.jobs.map(j => j.id)).toEqual(['first','second']);
        expect(sparkDMBatchHistory(state, 'c1', ['first','second']).map(m => m.content)).toEqual(['上午有空吗','我想一起去公园']);
        state = appendSparkDMBatchAnswer(state, 'c1', ['first','second'], '可以，一起去吧', 3);
        expect(state['c1'].map(m => m.content)).toEqual(['上午有空吗','我想一起去公园','可以，一起去吧']);
        expect(state['c1'].filter(m => m.role === 'user').every(m => m.delivery === 'sent')).toBe(true);
        expect(appendSparkDMBatchAnswer(state, 'c1', ['first','second'], '重复回复', 4)).toBe(state);
    });
    it('never mixes private requests for different character identities', async () => {
        const { takeSparkDMJobBatch } = await import('./sparkDMQueue');
        const queued = [
            { key: 'same-visible-name', accountId: 'character:one', id: 'a' },
            { key: 'same-visible-name', accountId: 'character:two', id: 'b' },
            { key: 'same-visible-name', accountId: 'character:two', id: 'c' },
        ];
        const first = takeSparkDMJobBatch(queued);
        expect(first.jobs.map(x => x.id)).toEqual(['a']);
        expect(takeSparkDMJobBatch(first.remaining).jobs.map(x => x.id)).toEqual(['b','c']);
    });
    it('never batches more than six queued messages into a provider call', async () => {
        const { takeSparkDMJobBatch } = await import('./sparkDMQueue');
        const queued = Array.from({ length: 8 }, (_, i) => ({ key: 'friend', accountId: 'stranger:1', id: 'm' + i }));
        const batch = takeSparkDMJobBatch(queued);
        expect(batch.jobs).toHaveLength(6);
        expect(batch.remaining).toHaveLength(2);
    });
    it('retains failed bubbles for each input rather than deleting the entire batch', async () => {
        const { appendSparkDMBatchAnswer } = await import('./sparkDMQueue');
        let state = appendSparkDMUser({}, 'friend', '一', 'm1', 1);
        state = appendSparkDMUser(state, 'friend', '二', 'm2', 2);
        state = setSparkDMDelivery(state, 'friend', 'm1', 'failed');
        state = appendSparkDMBatchAnswer(state, 'friend', ['m1','m2'], '收到', 3);
        expect(state['friend'][0].delivery).toBe('failed');
        expect(state['friend'][1].delivery).toBe('sent');
        expect(state['friend'].filter(m => m.role === 'assistant')).toHaveLength(1);
    });
});
