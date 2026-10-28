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
    it('does not lose a pending message when the same account still has two legacy thread keys', async () => {
        const { takeSparkDMJobBatch } = await import('./sparkDMQueue');
        const jobs = [
            { key: '昵称旧记录', accountId: 'character:c1:main', id: 'm1' },
            { key: 'character:c1:main', accountId: 'character:c1:main', id: 'm2' },
        ];
        expect(takeSparkDMJobBatch(jobs).jobs.map(j => j.id)).toEqual(['m1']);
        expect(takeSparkDMJobBatch(jobs).remaining.map(j => j.id)).toEqual(['m2']);
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

describe('Spark inbox concurrent recovery', () => {
    it('preserves a pending outgoing message while merging a separate NPC greeting', async () => {
        const { mergeSparkIncomingDMs } = await import('./sparkDMQueue');
        const justSent = appendSparkDMUser({}, 'character:one', '刚刚连续发出的消息', 'send-1', 10);
        const merged = mergeSparkIncomingDMs(justSent, [
            { key: 'stranger:second', name: '新网友', content: '嗨，看到你的笔记啦' },
        ], 11);
        expect(merged['character:one']).toEqual(justSent['character:one']);
        expect(merged['character:one'][0].delivery).toBe('pending');
        expect(merged['stranger:second'][0].content).toBe('嗨，看到你的笔记啦');
        expect(justSent['stranger:second']).toBeUndefined();
    });

    it('never replaces a recently sent user message with a late AI greeting', async () => {
        const { mergeSparkIncomingDMs } = await import('./sparkDMQueue');
        let current = appendSparkDMUser({}, 'stranger:new', '我先说了句话', 'send-2', 10);
        const after = mergeSparkIncomingDMs(current, [
            { key: 'stranger:new', name: '新网友', content: '迟到的开场白' },
        ], 15);
        expect(after).toBe(current);
        expect(after['stranger:new'].map(item => item.content)).toEqual(['我先说了句话']);
        current = mergeSparkIncomingDMs({}, [{ key: 'stranger:new', name: '新网友', content: '首次打招呼' }], 16);
        expect(mergeSparkIncomingDMs(current, [{ key: 'stranger:new', name: '新网友', content: '重复打招呼' }], 17)).toBe(current);
    });

    it('respects existing legacy-name threads when the account ID is newly registered', async () => {
        const { mergeSparkIncomingDMs } = await import('./sparkDMQueue');
        const legacy = appendSparkDMUser({}, '未迁移昵称', '原始旧私信', 'old', 3);
        const merged = mergeSparkIncomingDMs(legacy, [{ key: 'stranger:stable', name: '未迁移昵称', content: '不要覆盖旧记录' }], 5);
        expect(merged).toBe(legacy);
        expect(merged['stranger:stable']).toBeUndefined();
    });
});

describe('Spark DM draft identity isolation', () => {
    it('keeps two same-name users distinct by stable receiver ID', async () => {
        const { setSparkDMDraft } = await import('./sparkDMQueue');
        let drafts: Record<string, string> = {};
        drafts = setSparkDMDraft(drafts, 'stranger:alice', '只告诉 Alice 的话');
        drafts = setSparkDMDraft(drafts, 'stranger:bob', '只告诉 Bob 的话');
        expect(drafts['stranger:alice']).toBe('只告诉 Alice 的话');
        expect(drafts['stranger:bob']).toBe('只告诉 Bob 的话');
        const cleared = setSparkDMDraft(drafts, 'stranger:bob', '');
        expect(cleared['stranger:bob']).toBeUndefined();
        expect(cleared['stranger:alice']).toBe('只告诉 Alice 的话');
        expect(drafts['stranger:bob']).toBe('只告诉 Bob 的话');
    });

    it('does not create empty drafts or churn state when input is unchanged', async () => {
        const { setSparkDMDraft } = await import('./sparkDMQueue');
        const drafts = { 'character:a:handle:b': '未发送' };
        expect(setSparkDMDraft(drafts, '', '不安全')).toBe(drafts);
        expect(setSparkDMDraft(drafts, 'character:a:handle:b', '未发送')).toBe(drafts);
        expect(setSparkDMDraft(drafts, 'character:a:handle:b', '')).toEqual({});
    });
});

describe('Spark durable DM backup restore', () => {
    it('rejects malformed snapshots and never treats unreadable data as empty', async () => {
        const { parseSparkDMThreadSnapshot } = await import('./sparkDMQueue');
        expect(parseSparkDMThreadSnapshot(null)).toEqual({});
        expect(() => parseSparkDMThreadSnapshot('[]')).toThrow();
        expect(() => parseSparkDMThreadSnapshot('{"abc":[{"role":"assistant","content":4,"time":1}]}')).toThrow();
    });
    it('merges pending local sends, confirmed historical replies and independent receivers', async () => {
        const { mergeSparkDMThreadSnapshots, recoverSparkInterruptedDMs } = await import('./sparkDMQueue');
        const durable = recoverSparkInterruptedDMs({ alice: [
            { role: 'user', content: '先前消息', time: 10, id: 'm1', delivery: 'pending' },
            { role: 'assistant', content: '旧回复', time: 11 },
        ] });
        const live = { alice: [
            { role: 'user' as const, content: '先前消息', time: 10, id: 'm1', delivery: 'sent' as const },
            { role: 'user' as const, content: '新消息', time: 12, id: 'm2', delivery: 'pending' as const },
        ], bob: [{ role: 'assistant' as const, content: '其他人', time: 13 }] };
        const result = mergeSparkDMThreadSnapshots(durable, live);
        expect(result.alice.map(item => item.content)).toEqual(['先前消息', '旧回复', '新消息']);
        expect(result.alice[0].delivery).toBe('sent');
        expect(result.bob).toHaveLength(1);
    });
});

describe('Spark historical handle recovery migration', () => {
    it('moves an unambiguous old private thread onto the stable account id', async () => {
        const { migrateSparkDMKeys, createEmptySparkCommunityState, ensureSparkAccount } = await import('./sparkCommunity');
        const { mergeSparkDMThreadSnapshots } = await import('./sparkDMQueue');
        const actor = ensureSparkAccount(createEmptySparkCommunityState(),
            { type: 'stranger', id: 'stranger:alice', displayName: 'Alice' }, () => 'unused');
        const historic = { Alice: [{ role: 'user' as const, content: '旧私信', time: 2, id: 'one' }] };
        const next = migrateSparkDMKeys(mergeSparkDMThreadSnapshots(historic, {}), actor.state.accounts);
        expect(next['stranger:alice']).toHaveLength(1);
        expect(next.Alice).toBeUndefined();
    });
});

describe('Spark private-message sent receipts survive stale cache', () => {
    it('does not downgrade a durable sent message to failed or re-enable a paid retry', async () => {
        const { mergeSparkDMThreadSnapshots } = await import('./sparkDMQueue');
        const durable = { alice: [
            { role: 'user' as const, content: '已计费发言', time: 10, id: 'sent-1', delivery: 'sent' as const },
            { role: 'assistant' as const, content: '已经收到回复', time: 11, replyToId: 'sent-1' },
        ] };
        const staleLocal = { alice: [
            { role: 'user' as const, content: '已计费发言', time: 10, id: 'sent-1', delivery: 'failed' as const },
        ] };
        const merged = mergeSparkDMThreadSnapshots(durable, staleLocal);
        expect(merged.alice.find(message => message.id === 'sent-1')?.delivery).toBe('sent');
        expect(merged.alice.filter(message => message.replyToId === 'sent-1')).toHaveLength(1);
    });
});

describe('Spark private-message drafts survive storage failures', () => {
    it('restores a newer IndexedDB backup while keeping edits typed during loading', async () => {
        const { parseSparkDMDraftBackup, mergeSparkDMDraftRecovery } = await import('./sparkDMQueue');
        const backup = parseSparkDMDraftBackup(JSON.stringify({
            version: 1, updatedAt: 200,
            drafts: { 'character:a': '数据库较新草稿', 'character:b': '旧草稿' },
        }));
        expect(mergeSparkDMDraftRecovery({ 'character:a': '正在重新输入' }, 100, backup,
            new Set(['character:a', 'character:b']))).toEqual({ 'character:a': '正在重新输入' });
    });
    it('does not resurrect drafts explicitly cleared after a newer local snapshot', async () => {
        const { parseSparkDMDraftBackup, mergeSparkDMDraftRecovery } = await import('./sparkDMQueue');
        const backup = parseSparkDMDraftBackup(JSON.stringify({
            version: 1, updatedAt: 100, drafts: { alice: '已经发过的旧草稿' },
        }));
        expect(mergeSparkDMDraftRecovery({}, 200, backup, new Set())).toEqual({});
        expect(mergeSparkDMDraftRecovery({}, 0, backup, new Set(['alice']))).toEqual({});
    });
    it('preserves legacy per-account strings and rejects malformed snapshots', async () => {
        const { parseSparkDMDrafts, parseSparkDMDraftBackup } = await import('./sparkDMQueue');
        expect(parseSparkDMDrafts('{"alice":"未发内容","bob":""}')).toEqual({ alice: '未发内容' });
        expect(parseSparkDMDrafts(null)).toEqual({});
        expect(() => parseSparkDMDraftBackup('{"version":1,"updatedAt":3,"drafts":[]}')).toThrow();
        expect(() => parseSparkDMDrafts('[]')).toThrow();
    });
});

describe('Spark sent-DM draft snapshot protection', () => {
    it('clears the exact submitted text but never a later edit or extra whitespace', async () => {
        const { canClearSparkSentDMDraft } = await import('./sparkDMQueue');
        expect(canClearSparkSentDMDraft('  你好  ', '  你好  ')).toBe(true);
        expect(canClearSparkSentDMDraft('你好 ', '你好')).toBe(false);
        expect(canClearSparkSentDMDraft('你好新内容', '你好')).toBe(false);
        expect(canClearSparkSentDMDraft(undefined, '你好')).toBe(false);
    });
});
