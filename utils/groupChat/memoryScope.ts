import type { GroupProfile, Message } from '../../types';

/** 群归档数据保留在数据库中；本轮能否出现在个人聊天上下文由群的当前授权决定。 */
export function allowGroupMemoryInPrivate(groupId: string | undefined, groups: GroupProfile[], charId?: string): boolean {
    if (!groupId) return true; // 普通私聊记忆不是群记忆
    const group = groups.find(item => item.id === groupId);
    return Boolean(group && group.privateChatSyncEnabled !== false && (!charId || group.members.includes(charId)));
}

/** 已投递的话题卡片不做破坏性删除；关闭互通或解散群后从 AI 原文上下文隐去。 */
export function filterPrivateGroupTopicCards(messages: Message[], groups: GroupProfile[]): Message[] {
    return messages.filter(message => {
        if (message.type !== 'group_topic_card') return true;
        const groupId = message.metadata?.groupTopicBox?.groupId;
        // 元数据缺少归属的老卡片无法验证授权，安全地从 AI 上下文隐去（原记录保留）。
        return typeof groupId === 'string' && allowGroupMemoryInPrivate(groupId, groups, message.charId);
    });
}

/** 自动私聊记忆提取不能把群公共卡片加工成无来源标签的个人节点。
 * 公共卡片仍留在已授权的私聊上下文，真正的长期群记忆由 groupPipeline 独立写入 groupId。
 */
export function isPrivatePalaceSourceMessage(message: Message): boolean {
    return !message.groupId && message.type !== 'group_topic_card';
}

/** 禁止先前同步的向量群记忆绕过新的私聊互通开关继续回忆。 */
export function filterPrivateGroupMemoryCandidates<T extends { node: { groupId?: string; charId?: string } }>(
    candidates: T[],
    groups: GroupProfile[],
): T[] {
    return candidates.filter(candidate => allowGroupMemoryInPrivate(candidate.node.groupId, groups, candidate.node.charId));
}
