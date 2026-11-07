import { describe, expect, it } from 'vitest';
import { DB } from './db';
import { canUserRecallPrivateMessage } from './messageRecall';
import { findPendingUserTurn } from './chatContinuation';
import { findPendingRealPersonUserTurn } from './realPersonReplyTurn';
import { listContentFavorites, saveConversationContentFavorite, saveMessageContentFavorite } from './contentFavorites';

const uid = () => 'recall-fixture-' + Math.random().toString(36).slice(2);

describe('character recall is an actual persisted replacement, not an extra system line', () => {
    it('can manually recall a user message and leaves no extra system row', async () => {
        const charId = uid();
        const userId = await DB.saveMessage({ charId, role: 'user', type: 'text', content: '我说错了' });
        const replyId = await DB.saveMessage({ charId, role: 'assistant', type: 'text',
            content: '你说什么？', replyTo: { id: userId, content: '我说错了', name: '我' } });
        const before = await DB.getRecentMessagesByCharId(charId, 20);
        expect(canUserRecallPrivateMessage(before[0])).toBe(true);
        const changed = await DB.recallUserPrivateMessage(charId, userId, true);
        expect(changed?.metadata?.recalledBy).toBe('user');
        expect(changed?.metadata?.recalledCharSaw).toBe(true);
        expect(changed?.metadata?.recalledOriginalContent).toBe('我说错了');
        const after = await DB.getRecentMessagesByCharId(charId, 20);
        expect(after).toHaveLength(before.length);
        expect(after[0].id).toBe(userId);
        expect(after[0].content).toBe('[消息已撤回]');
        expect(after[0].metadata?.recalledAt).toBeGreaterThan(0);
        expect(after[1].replyTo?.content).toBe('[消息已撤回]');
        expect((await DB.getMessageById(replyId))?.replyTo?.content).toBe('[消息已撤回]');
        expect(canUserRecallPrivateMessage(after[0])).toBe(false);
        expect(await DB.recallUserPrivateMessage(charId, userId)).toBeNull();
    });

    it('does not let a withdrawn user turn retrigger an unanswered auto response', async () => {
        const charId = uid();
        const id = await DB.saveMessage({ charId, role: 'user', type: 'text', content: '撤回我' });
        expect(findPendingUserTurn(await DB.getRecentMessagesByCharId(charId, 12))?.id).toBe(id);
        expect(await DB.recallUserPrivateMessage(charId, id)).not.toBeNull();
        const refreshed = await DB.getRecentMessagesByCharId(charId, 12);
        expect(findPendingUserTurn(refreshed)).toBeNull();
        expect(findPendingRealPersonUserTurn(refreshed)).toBeNull();
    });

    it('cannot manually recall a different character, system message or a transaction', async () => {
        const c = uid(), other = uid();
        const otherId = await DB.saveMessage({ charId: other, role: 'user', type: 'text', content: 'other' });
        const systemId = await DB.saveMessage({ charId: c, role: 'system', type: 'text', content: 'system' });
        const payId = await DB.saveMessage({ charId: c, role: 'user', type: 'transfer', content: '支付 5 元' });
        expect(await DB.recallUserPrivateMessage(c, otherId)).toBeNull();
        expect(await DB.recallUserPrivateMessage(c, systemId)).toBeNull();
        expect(await DB.recallUserPrivateMessage(c, payId)).toBeNull();
        expect((await DB.getMessageById(payId))?.content).toBe('支付 5 元');
    });

    it('supports voice, photo and emoji messages without leaving the original bubble visible', async () => {
        for (const type of ['voice', 'image', 'emoji'] as const) {
            const charId = uid();
            const id = await DB.saveMessage({ charId, role: 'user', type, content: '原始资源' });
            const recalled = await DB.recallUserPrivateMessage(charId, id);
            expect(recalled?.type).toBe('text');
            expect(recalled?.content).toBe('[消息已撤回]');
            expect(recalled?.metadata?.recalledOriginalType).toBe(type);
            expect((await DB.getMessageById(id))?.content).toBe('[消息已撤回]');
        }
    });

    it('hides the original in the same row and scrubs quoted snapshots', async () => {
        const charId = uid();
        const id = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '喜欢你' });
        const quotedId = await DB.saveMessage({
            charId, role: 'user', type: 'text', content: '你刚刚说什么？',
            replyTo: { id, content: '喜欢你', name: '角色' },
        });
        const before = await DB.getRecentMessagesByCharId(charId, 10);
        expect(before).toHaveLength(2);
        expect(await DB.recallAssistantPrivateMessage(charId, '喜欢你')).toBe(id);
        const after = await DB.getRecentMessagesByCharId(charId, 10);
        expect(after).toHaveLength(2); // no extra system message
        expect(after[0].id).toBe(id);
        expect(after[0].content).toBe('[消息已撤回]');
        expect(after[0].metadata?.recalledAt).toBeGreaterThan(0);
        expect(JSON.stringify(after[0])).not.toContain('recalledOriginalContent');
        expect(JSON.stringify(after[0])).not.toContain('喜欢你');
        expect(after[1].replyTo?.content).toBe('[消息已撤回]');
        expect((await DB.getMessageById(quotedId))?.replyTo?.content).toBe('[消息已撤回]');
        expect(await DB.recallAssistantPrivateMessage(charId, '喜欢你')).toBeNull(); // idempotent
    });

    it('can withdraw a bilingual message using its original-language wording', async () => {
        const charId = uid();
        const id = await DB.saveMessage({ charId, role: 'assistant', type: 'text',
            content: 'I miss you\n%%BILINGUAL%%\n我想你了' });
        expect(await DB.recallAssistantPrivateMessage(charId, 'I miss you')).toBe(id);
        expect((await DB.getMessageById(id))?.content).toBe('[消息已撤回]');
    });

    it('withdraws stored favorite snapshots and prevents stale UI snapshots from recreating old text', async () => {
        const charId = uid(), other = uid();
        const targetId = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '不应泄漏的旧话' });
        const quoteId = await DB.saveMessage({ charId, role: 'user', type: 'text', content: '你说什么？',
            replyTo: { id: targetId, name: '角色', content: '不应泄漏的旧话' } });
        const otherId = await DB.saveMessage({ charId: other, role: 'assistant', type: 'text', content: '另一角色的对话' });
        const original = (await DB.getMessageById(targetId))!;
        const quoted = (await DB.getMessageById(quoteId))!;
        const otherMsg = (await DB.getMessageById(otherId))!;
        await saveMessageContentFavorite(original, '角色');
        await saveMessageContentFavorite(quoted, '角色');
        await saveMessageContentFavorite(otherMsg, '其他角色');
        await saveConversationContentFavorite([original, quoted], charId, '角色', '我');
        expect(await DB.recallAssistantPrivateMessage(charId, '不应泄漏的旧话')).toBe(targetId);
        const current = (await listContentFavorites()).filter(item => item.charId === charId && item.kind === 'chat');
        expect(current.length).toBeGreaterThanOrEqual(3);
        expect(current.every(item => !JSON.stringify(item).includes('不应泄漏的旧话'))).toBe(true);
        expect(JSON.stringify((await listContentFavorites()).find(item => item.charId === other)))
            .toContain('另一角色的对话');
        // A cached multi-select passed from React must read current DB content.
        await saveConversationContentFavorite([original, quoted], charId, '角色', '我');
        await saveMessageContentFavorite(original, '角色');
        expect((await listContentFavorites()).filter(item => item.charId === charId)
            .every(item => !JSON.stringify(item).includes('不应泄漏的旧话'))).toBe(true);
    });

    it('repairs legacy metadata and independently stored favorites on chat reopening', async () => {
        const charId = uid();
        const id = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '旧版本泄漏的原文' });
        await saveMessageContentFavorite((await DB.getMessageById(id))!, '角色');
        await DB.updateMessage(id, '[消息已撤回]');
        await DB.updateMessageMetadata(id, prev => ({
            ...prev, recalledAt: Date.now(), recalledOriginalContent: '旧版本泄漏的原文',
        }));
        expect((await DB.getMessageById(id))?.metadata?.recalledOriginalContent).toBe('旧版本泄漏的原文');
        expect(await DB.scrubLegacyRecalledMetadata(charId)).toBe(1);
        expect(await DB.scrubLegacyRecalledMetadata(charId)).toBe(0);
        expect(JSON.stringify(await DB.getMessageById(id))).not.toContain('旧版本泄漏的原文');
        const { reconcileStoredRecalledFavoritesForCharacter } = await import('./contentFavorites');
        await reconcileStoredRecalledFavoritesForCharacter(charId);
        const saved = (await listContentFavorites()).find(x => x.kind === 'chat' && x.charId === charId);
        expect(JSON.stringify(saved)).not.toContain('旧版本泄漏的原文');
    });

    it('cannot withdraw the user or a different character\'s words', async () => {
        const charId = uid();
        const other = uid();
        const userId = await DB.saveMessage({ charId, role: 'user', type: 'text', content: '别走' });
        const otherId = await DB.saveMessage({ charId: other, role: 'assistant', type: 'text', content: '好的' });
        expect(await DB.recallAssistantPrivateMessage(charId, '别走')).toBeNull();
        expect(await DB.recallAssistantPrivateMessage(charId, '好的')).toBeNull();
        expect((await DB.getMessageById(userId))?.content).toBe('别走');
        expect((await DB.getMessageById(otherId))?.content).toBe('好的');
    });

    it('targets the latest matching private message when text is repeated', async () => {
        const charId = uid();
        const first = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '嗯' });
        const second = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '嗯' });
        expect(await DB.recallAssistantPrivateMessage(charId, '嗯')).toBe(second);
        expect((await DB.getMessageById(first))?.content).toBe('嗯');
        expect((await DB.getMessageById(second))?.content).toBe('[消息已撤回]');
    });
});
