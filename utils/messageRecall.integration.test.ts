import { describe, expect, it } from 'vitest';
import { DB } from './db';

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
        expect(after[1].replyTo?.content).toBe('[消息已撤回]');
        expect((await DB.getMessageById(quotedId))?.replyTo?.content).toBe('[消息已撤回]');
        expect(await DB.recallAssistantPrivateMessage(charId, '喜欢你')).toBeNull(); // idempotent
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
