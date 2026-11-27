import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import type { CharacterProfile, MountedWorldbook, UserProfile } from '../types';

const user = { name: '用户甲', bio: '' } as UserProfile;

describe('实际聊天提示词中的身份关系优先级', () => {
    it('实际 ChatPrompts 生成的 system prompt 将当前身份关系放在冲突资料之后', async () => {
        const char = {
            id: 'identity-playtest',
            name: '角色甲',
            avatar: '',
            description: '',
            memories: [],
            timeAwarenessEnabled: false,
            systemPrompt: '人设冲突：你们已交往多年。',
            worldview: '世界观冲突：用户是你的恋人。',
            identityRelationship: '你们是网上认识的普通网友，尚未见面。',
            mountedWorldbooks: [{
                id: 'relationship-conflict',
                title: '冲突关系条目',
                content: '世界书冲突：用户是角色的伴侣。',
                constant: true,
                position: 6,
            } as MountedWorldbook],
        } as CharacterProfile;
        const parts = await ChatPrompts.buildSystemPromptParts(
            char, user, [], [], [], [
                { id: 1, charId: char.id, role: 'user', type: 'text', content: '我们是什么关系？', timestamp: Date.now() } as any,
            ],
            { weatherEnabled: false, newsEnabled: false } as any,
        );
        const prompt = parts.stable + parts.volatileState + parts.recencyTail;
        expect(parts.recencyTail).toContain('生成前最终复核 · 最高优先级');
        expect(parts.recencyTail).toContain(char.identityRelationship);
        const finalRule = prompt.lastIndexOf('生成前最终复核 · 最高优先级');
        expect(prompt).toContain('人设冲突：你们已交往多年。');
        expect(prompt).toContain('世界观冲突：用户是你的恋人。');
        expect(prompt).toContain('世界书冲突：用户是角色的伴侣。');
        expect(finalRule).toBeGreaterThan(prompt.indexOf('世界书冲突：用户是角色的伴侣。'));
        expect(prompt.slice(finalRule)).toContain(char.identityRelationship);
        expect(prompt.slice(finalRule)).toContain('均以此处当前身份关系为准');
        expect(parts.history.some(message => String(message.content).includes('我们是什么关系？'))).toBe(true);
    });
});
