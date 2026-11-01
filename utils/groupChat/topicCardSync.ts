import type { GroupProfile, GroupTopicBox } from '../../types';
import { DB } from '../db';

export type GroupTopicCardSyncResult = { deliveredMemberIds: string[]; failedMemberIds: string[] };

const hasCardForBox = (messages: Awaited<ReturnType<typeof DB.getMessagesByCharId>>, box: GroupTopicBox): boolean =>
    messages.some(message => message.type === 'group_topic_card'
        && message.metadata?.groupTopicBox?.id === box.id);

/**
 * 公共话题盒已落盘、个别成员卡片写入失败时，下次进入群聊可安全补发。
 * 不改变原群聊历史、私聊消息顺序、话题盒 ID；只补缺失的私聊卡片。
 */
export async function ensureGroupTopicCardsDelivered(group: GroupProfile): Promise<GroupTopicCardSyncResult> {
    const result: GroupTopicCardSyncResult = { deliveredMemberIds: [], failedMemberIds: [] };
    if (!group.topicBoxes?.length || group.privateChatSyncEnabled === false) return result;

    for (const memberId of group.members) {
        try {
            const current = (await DB.getGroups()).find(item => item.id === group.id);
            if (!current || current.privateChatSyncEnabled === false) return result;
            if (!current.members.includes(memberId)) continue;
            const eligible = (current.topicBoxes || []).filter(box =>
                (box.deliveredMemberIds || current.members).includes(memberId));
            if (eligible.length === 0) continue;
            const existing = await DB.getMessagesByCharId(memberId, true);
            for (const box of eligible) {
                if (hasCardForBox(existing, box)) continue;
                // 成盒期间用户可能关闭互通或解散群；每张卡写入前重新确认授权。
                const latest = (await DB.getGroups()).find(item => item.id === group.id);
                if (!latest || latest.privateChatSyncEnabled === false || !latest.members.includes(memberId)) return result;
                if (!(latest.topicBoxes || []).some(item => item.id === box.id)) continue;
                await DB.saveMessage({
                    charId: memberId,
                    role: 'system',
                    type: 'group_topic_card',
                    content: `[群聊公共话题盒：${group.name}｜${box.title}]\n${box.summary}`,
                    metadata: { groupTopicBox: { ...box, groupName: group.name } },
                });
                result.deliveredMemberIds.push(memberId);
                // 本次生成的卡片也进入已知集合，不会在一个批次里被重复派发。
                existing.push({ id: -1, charId: memberId, groupId: undefined, role: 'system', type: 'group_topic_card', content: '', timestamp: Date.now(), metadata: { groupTopicBox: { id: box.id } } });
            }
        } catch (error) {
            console.warn('[GroupTopicCardSync] 卡片写入失败，下次进入该群重试:', group.id, memberId, error);
            result.failedMemberIds.push(memberId);
        }
    }
    return result;
}
