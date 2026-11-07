import { describe, expect, it } from 'vitest';
import { DB } from './db';
import { listContentFavorites, saveConversationContentFavorite, saveMessageContentFavorite } from './contentFavorites';

const uid = () => 'recall-fixture-' + Math.random().toString(36).slice(2);

describe('character recall is an actual persisted replacement, not an extra system line', () => {
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
