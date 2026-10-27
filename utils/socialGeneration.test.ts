import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message, SocialPost, UserProfile } from '../types';
import { buildSparkCommentHistory, buildSparkGenerationContext, resolveSparkAuthor, selectSparkParticipants } from './socialGeneration';

const character = (id: string, name: string, systemPrompt: string) => ({
    id, name, systemPrompt, avatar: '', description: '', memories: [], timeAwarenessEnabled: false,
} as CharacterProfile);
const a = character('a-id', '阿青', '我是安静的园丁，只聊花草');
const b = character('b-id', 'Sully', '我是爱讲冷笑话的程序员');
const c = character('c-id', '阿白', '不应传入的第三人人设');
const chars = [a, b, c];
const handles = { 'a-id': [{ id: 'a', handle: '小花园', note: '主号' }], 'b-id': [{ id: 'b', handle: 'SullyDev', note: '技术号' }] };
const user = { name: '林雨', bio: '用户是一名画家', avatar: '' } as UserProfile;
const social = { name: '雨的账号', bio: '画画日记', avatar: '' };
const resolve = (item: any, participants = [a, b]) => resolveSparkAuthor(item, participants, chars, handles, [user.name, social.name]);

describe('Spark persona and conversation context', () => {
    it('keeps multi-character public requests separate from any role private chats and system prompts', async () => {
        const context = await buildSparkGenerationContext([a, b], user, social, handles, {
            'a-id': [{ role: 'user', content: '明天去看花展' } as Message],
            'b-id': [{ role: 'user', content: '私人密码只告诉Sully' } as Message],
            'c-id': [{ role: 'user', content: '第三人的秘密' } as Message],
        }, { 'a-id': ['只供阿青记忆的隐私'], 'b-id': ['只供Sully记忆的隐私'] });
        for (const shown of [user.name, social.name, 'a-id', 'b-id', '小花园', 'SullyDev']) expect(context).toContain(shown);
        for (const privatePart of [a.systemPrompt, b.systemPrompt, c.systemPrompt,
            '明天去看花展', '私人密码只告诉Sully', '第三人的秘密',
            '只供阿青记忆的隐私', '只供Sully记忆的隐私']) expect(context).not.toContain(privatePart);
    });

    it('retains the appropriate full persona and own private continuity for a single character', async () => {
        const context = await buildSparkGenerationContext([a], user, social, handles, {
            'a-id': [{ role: 'user', content: '明天去看花展' } as Message],
            'b-id': [{ role: 'user', content: '私人密码只告诉Sully' } as Message],
        }, { 'a-id': ['阿青只记得自己的笔记收到一条评论'], 'b-id': ['Sully只记得自己分享过一篇笔记'] });
        expect(context).toContain(a.systemPrompt);
        expect(context).toContain('明天去看花展');
        expect(context).toContain('阿青只记得自己的笔记收到一条评论');
        expect(context).not.toContain(b.systemPrompt);
        expect(context).not.toContain('私人密码只告诉Sully');
        expect(context).not.toContain('Sully只记得自己分享过一篇笔记');
    });

    it('keeps the post author and recent interlocutors ahead of random candidates', () => {
        const post = { authorName: '小花园', authorType: 'character', authorCharId: 'a-id', comments: [
            { authorName: 'SullyDev', authorCharId: 'b-id', authorType: 'character', content: '你指的是周六那次吗？' },
            { authorName: social.name, authorType: 'user', content: '对，就是那次' },
        ] } as SocialPost;
        expect(selectSparkParticipants(post, [c, b, a], handles).map(ch => ch.id)).toEqual(['a-id', 'b-id']);
        const history = buildSparkCommentHistory(post);
        expect(history).toContain('周六那次');
        expect(history).toContain('对，就是那次');
    });

    it('supports characters without saved Spark handles', async () => {
        expect((await buildSparkGenerationContext([c], user, social, {})).includes('阿白')).toBe(true);
        expect(resolve({ author: '阿白', charId: 'c-id' }, [c])?.character).toBe(c);
    });
});

describe('Spark author attribution', () => {
    it('rejects an ID that contradicts the handle instead of attaching the wrong avatar/persona', () => {
        expect(resolve({ authorName: '小花园', charId: 'b-id', isCharacter: true })).toBeNull();
        expect(resolve({ author: '小花园', charId: 'invented-id' })).toBeNull();
    });
    it('rejects unselected characters, user impersonation and strangers using character handles', () => {
        expect(resolve({ author: '阿白', charId: 'c-id' })).toBeNull();
        expect(resolve({ author: ' 林雨 ' })).toBeNull();
        expect(resolve({ author: social.name })).toBeNull();
        expect(resolve({ author: '小花园', isCharacter: false })).toBeNull();
    });
    it('accepts unambiguous legacy handle-only output and preserves canonical names', () => {
        expect(resolve({ author: ' sullydev ' })).toEqual({ name: 'SullyDev', character: b });
        expect(resolve({ author: '新来的路人', charId: null })).toEqual({ name: '新来的路人' });
    });
    it('requires the matching ID when two roles share a handle', () => {
        const duplicate = { ...handles, 'b-id': [{ id: 'b', handle: '小花园', note: '' }] };
        expect(resolveSparkAuthor({ author: '小花园' }, [a, b], chars, duplicate, [])).toBeNull();
        expect(resolveSparkAuthor({ author: '小花园', charId: 'b-id' }, [a, b], chars, duplicate, [])?.character).toBe(b);
    });
});

describe('Spark public output private-chat guard', () => {
    it('rejects a long copied private message but not ordinary short public phrases', async () => {
        const { containsSparkPrivateQuote } = await import('./socialGeneration');
        const privateText = '昨天在老地方我悄悄告诉你的那一段没有对任何人说过的秘密和接下来的安排';
        expect(containsSparkPrivateQuote('今天分享一个秘密：' + privateText, [privateText])).toBe(true);
        expect(containsSparkPrivateQuote('今天分享一些画画心得～', [privateText])).toBe(false);
        expect(containsSparkPrivateQuote('画画', [privateText])).toBe(false);
    });
});

describe('Spark alt profile privacy', () => {
    it('keeps anonymous avatars stable and different from the character main photo', async () => {
        const { getSparkAuthorAvatar } = await import('./socialGeneration');
        const char = { ...a, avatar: 'blobref:private-main-photo' };
        const configured = { 'a-id': [
            { id: 'default', handle: '主号', note: '主账号' },
            { id: 'alt-1', handle: '画画树洞', note: '匿名吐槽' },
        ] };
        expect(getSparkAuthorAvatar(char, '主号', configured)).toBe(char.avatar);
        const hidden = getSparkAuthorAvatar(char, '画画树洞', configured);
        expect(hidden).not.toBe(char.avatar);
        expect(hidden).toBe(getSparkAuthorAvatar(char, '改名后的树洞', configured, 'alt-1'));
    });
});

describe('Spark public request worldbook isolation', () => {
    it('never injects private worldbook content into a shared public generation request', async () => {
        const { buildSparkGenerationRequestMessages } = await import('./socialGeneration');
        const privateA = { ...a, mountedWorldbooks: [{ id: 'secret-a', title: '私人世界书A', entries: [{ content: '甲角色不公开的秘密内容' }] }] } as unknown as CharacterProfile;
        const privateB = { ...b, mountedWorldbooks: [{ id: 'secret-b', title: '私人世界书B', entries: [{ content: '乙角色不公开的秘密内容' }] }] } as unknown as CharacterProfile;
        const messages = buildSparkGenerationRequestMessages([privateA, privateB], user, '仅公开资料', '写两条公开帖子');
        expect(messages).toEqual([
            { role: 'system', content: '仅公开资料' },
            { role: 'user', content: '写两条公开帖子' },
        ]);
        expect(JSON.stringify(messages)).not.toContain('甲角色不公开的秘密内容');
        expect(JSON.stringify(messages)).not.toContain('乙角色不公开的秘密内容');
    });
});
