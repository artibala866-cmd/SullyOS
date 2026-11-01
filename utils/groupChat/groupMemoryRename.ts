import { DB } from '../db';
import { MemoryNodeDB } from '../memoryPalace/db';

/**
 * 群改名后，把已投递的私聊话题卡片标题及宫殿群来源元数据同步为现名。
 * 群历史消息、提取出的记忆正文均原样保留：改名不能篡改过去发生的事实。
 */
export async function syncGroupMemoryName(groupId: string, newName: string): Promise<{ cards: number; nodes: number }> {
    if (!groupId || !newName.trim()) return { cards: 0, nodes: 0 };
    const characters = await DB.getAllCharacters();
    let cards = 0;
    let nodes = 0;
    for (const member of characters) {
        const [messages, memories] = await Promise.all([
            DB.getMessagesByCharId(member.id, true),
            MemoryNodeDB.getByCharId(member.id),
        ]);
        for (const message of messages) {
            if (message.type !== 'group_topic_card' || message.metadata?.groupTopicBox?.groupId !== groupId) continue;
            const title = String(message.metadata.groupTopicBox.title || '一段群聊回忆');
            const nextHeader = '[群聊公共话题盒：' + newName + '｜' + title + ']';
            const updatedText = message.content.replace(/^\[群聊公共话题盒：[^\n]*\]/, nextHeader);
            if (updatedText !== message.content) await DB.updateMessage(message.id, updatedText);
            await DB.updateMessageMetadata(message.id, previous => ({
                ...(previous || {}),
                groupTopicBox: { ...(previous?.groupTopicBox || {}), groupName: newName },
            }));
            cards++;
        }
        for (const node of memories) {
            if (node.groupId !== groupId || node.groupName === newName) continue;
            await MemoryNodeDB.save({ ...node, groupName: newName });
            nodes++;
        }
    }
    return { cards, nodes };
}
