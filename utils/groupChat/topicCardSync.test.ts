import { describe, expect, it } from 'vitest';
import type { GroupProfile, GroupTopicBox } from '../../types';
import { DB } from '../db';
import { ensureGroupTopicCardsDelivered } from './topicCardSync';

let counter = 0;
async function makeGroup(sync = true) {
    const id = 'topic-card-repair-' + (++counter);
    const box: GroupTopicBox = {
        id: id + '-box', groupId: id, title: '一次群聊', summary: '大家谈论课程。',
        sourceStartMessageId: 1, sourceEndMessageId: 100,
        messageCount: 100, participants: ['member-a'], deliveredMemberIds: [id + '-member'],
        createdAt: 1700000000000, updatedAt: 1700000000000,
    };
    const group: GroupProfile = {
        id, name: '群组', members: [id + '-member'], createdAt: 1,
        privateChatSyncEnabled: sync, topicBoxes: [box],
    };
    await DB.saveGroup(group);
    return { group, box, memberId: id + '-member' };
}
describe('公共话题盒卡片投递补偿', () => {
    it('崩溃后重进只补缺失卡片，重复运行不再新增', async () => {
        const { group, memberId, box } = await makeGroup();
        const first = await ensureGroupTopicCardsDelivered(group);
        expect(first.deliveredMemberIds).toEqual([memberId]);
        await ensureGroupTopicCardsDelivered(group);
        const cards = (await DB.getMessagesByCharId(memberId, true))
            .filter(message => message.metadata?.groupTopicBox?.id === box.id);
        expect(cards).toHaveLength(1);
    });
    it('关闭互通时不写入，重新开启后只补当前授权成员', async () => {
        const { group, memberId } = await makeGroup(false);
        expect((await ensureGroupTopicCardsDelivered(group)).deliveredMemberIds).toEqual([]);
        await DB.saveGroup({ ...group, privateChatSyncEnabled: true });
        expect((await ensureGroupTopicCardsDelivered({ ...group, privateChatSyncEnabled: true })).deliveredMemberIds).toEqual([memberId]);
    });
    it('群已删除不补卡，也不会写给已退出群的旧成员', async () => {
        const { group, memberId } = await makeGroup();
        await DB.saveGroup({ ...group, members: [] });
        expect((await ensureGroupTopicCardsDelivered(group)).deliveredMemberIds).toEqual([]);
        expect(await DB.getMessagesByCharId(memberId, true)).toEqual([]);
    });
});
