import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../../types';
import { DB } from '../db';
import { MemoryNodeDB } from '../memoryPalace/db';
import { syncGroupMemoryName } from './groupMemoryRename';

describe('群改名时同步私聊卡片与记忆来源', () => {
    it('只改本群名称元数据，保留记忆正文和其他群记录', async () => {
        const memberId = 'group-rename-member';
        await DB.saveCharacter({ id: memberId, name: '成员', memories: [] } as CharacterProfile);
        const groupId = 'group-rename-test';
        const otherId = 'group-rename-other';
        await DB.saveMessage({
            charId: memberId,
            role: 'system',
            type: 'group_topic_card',
            content: '[群聊公共话题盒：旧群｜一起画画]\\n大家完成了合作。',
            metadata: { groupTopicBox: { id: 'box-rename', groupId, title: '一起画画', groupName: '旧群' } },
        });
        await DB.saveMessage({
            charId: memberId,
            role: 'system',
            type: 'group_topic_card',
            content: '[群聊公共话题盒：别群｜别的事]\\n别的群经历。',
            metadata: { groupTopicBox: { id: 'box-other', groupId: otherId, title: '别的事', groupName: '别群' } },
        });
        await MemoryNodeDB.save({
            id: 'group-rename-node', charId: memberId, content: '在【旧群】里大家认识了。',
            groupId, groupName: '旧群', room: 'study', importance: 5, mood: 'neutral',
            tags: [], embedded: false, createdAt: 1700000000000, lastAccessedAt: 1700000000000,
            accessCount: 0, origin: 'extraction',
        });
        const report = await syncGroupMemoryName(groupId, '新群');
        expect(report).toEqual({ cards: 1, nodes: 1 });
        const cards = (await DB.getMessagesByCharId(memberId, true)).filter(m => m.type === 'group_topic_card');
        expect(cards.find(m => m.metadata?.groupTopicBox?.groupId === groupId)?.content).toContain('新群｜一起画画');
        expect(cards.find(m => m.metadata?.groupTopicBox?.groupId === groupId)?.content).toContain('大家完成了合作');
        expect(cards.find(m => m.metadata?.groupTopicBox?.groupId === otherId)?.content).toContain('别群｜别的事');
        const node = await MemoryNodeDB.getById('group-rename-node');
        expect(node?.groupName).toBe('新群');
        expect(node?.content).toBe('在【旧群】里大家认识了。');
    });
});
