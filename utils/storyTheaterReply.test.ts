import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { deleteStoryTheaterFloor, loadStoryActorContext, replaceStoryTheaterReply, updateStoryTheaterFloor } from './storyTheaterReply';

describe('剧情重写上下文和保存', () => {
    it('本剧情的用户/助手镜像都不回流，仍保留其他来源和剧情的可见原文', async () => {
        const char = { id: 'reroll-actor', contextRangeMode: 'manual', contextLimit: 20, contextRangePolicyVersion: 1 } as CharacterProfile;
        for (const [content, metadata] of [
            ['私聊', { source: 'chat' }],
            ['别的剧情', { source: 'story_theater_memory', theaterId: 'other' }],
            ['本轮输入', { source: 'story_theater_memory', theaterId: 'current' }],
            ['旧回复', { source: 'story_theater_memory', theaterId: 'current' }],
        ] as const) await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content, metadata });
        expect((await loadStoryActorContext(char, 'current', 20)).map(message => message.content)).toEqual(['私聊', '别的剧情']);
    });
    const seed = async (id: string): Promise<Message> => {
        const threadId = `story-theater:${id}`;
        await DB.saveStoryTheaterTurn(
            { charId: threadId, role: 'assistant', type: 'text', content: '旧回复',
                timestamp: 1770000000000, metadata: { source: 'story_theater', theaterId: id } },
            centralId => [{ charId: threadId + '-actor', role: 'assistant', type: 'text', content: '旧回复',
                timestamp: 1770000000000, metadata: { source: 'story_theater_memory', theaterId: id, theaterCentralId: centralId } }],
        );
        return (await DB.getMessagesByCharId(threadId, true))[0];
    };
    it('成功后原位原子替换，中央正文和镜像不会多出一条', async () => {
        const old = await seed('reroll-save');
        await replaceStoryTheaterReply(old, '新回复', { theaterPromptTokens: 123 });
        const rows = await DB.getMessagesByCharId(old.charId, true);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: old.id, content: '新回复', metadata: { theaterPromptTokens: 123 } });
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('新回复');
    });
    it('拒绝把过期镜像索引指向别的会话中正文相同的消息', async () => {
        const old = await seed('reroll-wrong-link');
        const foreignId = await DB.saveMessage({ charId: 'unrelated-private-chat',
            role: 'assistant', type: 'text', content: '旧回复', metadata: { source: 'chat' } });
        await DB.updateMessageMetadata(old.id, previous => ({
            ...previous, theaterMirrorIds: { stranger: foreignId },
        }));
        const corrupted = await DB.getMessageById(old.id);
        await expect(replaceStoryTheaterReply(corrupted!, '新回复', {})).rejects.toThrow('引用错误');
        expect((await DB.getMessageById(foreignId))?.content).toBe('旧回复');
        expect((await DB.getMessageById(old.id))?.content).toBe('旧回复');
    });
    it('已选的卡片开场首幕不可被普通 AI 重写覆盖，其他回复仍可重写', async () => {
        const theaterId = 'reroll-fixed-opening';
        const id = await DB.saveStoryTheaterTurn({
            charId: `story-theater:${theaterId}`, role: 'assistant', type: 'text',
            content: '原角色卡开场，不应被重新生成',
            timestamp: 1770000000000,
            metadata: { source: 'story_theater', theaterId,
                theaterOpeningGreeting: { characterId: 'role-a', greetingId: 'opening-a' } },
        }, () => []);
        const original = (await DB.getMessageById(id))!;
        await expect(replaceStoryTheaterReply(original, '错误的新开场', {}))
            .rejects.toThrow('不能重新生成');
        expect((await DB.getMessageById(id))?.content).toBe(original.content);
        // A stale caller without the metadata cannot bypass the stored protection.
        const stale = { ...original, metadata: { ...original.metadata, theaterOpeningGreeting: undefined } };
        await expect(replaceStoryTheaterReply(stale, '错误的新开场', {}))
            .rejects.toThrow('已被修改');
        expect((await DB.getMessageById(id))?.content).toBe(original.content);
    });
    it('任意镜像在请求期间被编辑，整个事务回滚保留用户修改和原正文', async () => {
        const old = await seed('reroll-conflict');
        const mirrorId = Number((old.metadata?.theaterMirrorIds as Record<string, number>)[old.charId + '-actor']);
        await DB.updateMessage(mirrorId, '手动编辑');
        await expect(replaceStoryTheaterReply(old, '新回复', {})).rejects.toThrow('已被修改');
        expect((await DB.getMessagesByCharId(old.charId, true))[0].content).toBe('旧回复');
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('手动编辑');
    });
    it('长篇阅读编辑 AI 正文：主剧情与角色镜像一次提交，不会有部分新旧版本', async () => {
        const original = await seed('floor-edit-atomic');
        const mirrorId = Number(Object.values(original.metadata?.theaterMirrorIds || {})[0]);
        await updateStoryTheaterFloor(original, '用户修正的正文');
        expect((await DB.getMessageById(original.id))?.content).toBe('用户修正的正文');
        expect((await DB.getMessageById(mirrorId))?.content).toBe('用户修正的正文');
        await expect(updateStoryTheaterFloor(original, '过期页面的修改')).rejects.toThrow('已改变');
        expect((await DB.getMessageById(mirrorId))?.content).toBe('用户修正的正文');
    });

    it('角色镜像在编辑期间被修改时，主剧情不得先保存一半', async () => {
        const original = await seed('floor-edit-conflict');
        const mirrorId = Number(Object.values(original.metadata?.theaterMirrorIds || {})[0]);
        await DB.updateMessage(mirrorId, '角色侧已更改');
        await expect(updateStoryTheaterFloor(original, '错误的部分修改')).rejects.toThrow('已改变');
        expect((await DB.getMessageById(original.id))?.content).toBe('旧回复');
        expect((await DB.getMessageById(mirrorId))?.content).toBe('角色侧已更改');
    });

    it('删除楼层前拒绝错误关联到私聊消息的镜像 ID，不会误删私聊', async () => {
        const original = await seed('floor-delete-foreign');
        const foreign = await DB.saveMessage({
            charId: 'user-private-messages', role: 'assistant', type: 'text',
            content: '私聊的重要文字', metadata: { source: 'chat' },
        });
        await DB.updateMessageMetadata(original.id, previous => ({
            ...previous, theaterMirrorIds: { stranger: foreign },
        }));
        const current = await DB.getMessageById(original.id);
        await expect(deleteStoryTheaterFloor(current!)).rejects.toThrow('未执行删除');
        expect((await DB.getMessageById(foreign))?.content).toBe('私聊的重要文字');
        expect((await DB.getMessageById(original.id))?.content).toBe('旧回复');
    });

    it('正常删除同时清理主剧情和对应镜像，不残留另一份楼层', async () => {
        const original = await seed('floor-delete-consistent');
        const mirrorId = Number(Object.values(original.metadata?.theaterMirrorIds || {})[0]);
        await deleteStoryTheaterFloor(original);
        expect(await DB.getMessageById(original.id)).toBeNull();
        expect(await DB.getMessageById(mirrorId)).toBeNull();
    });

});
