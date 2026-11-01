import type { CharacterAccommodationPolicy, Message } from '../../types';
import {
    analyzeUserInteraction,
    renderInteractionAdaptationGuidance,
    INTERACTION_TREND_MESSAGE_SCAN_LIMIT,
} from '../memoryPalace/interactionAdaptation';

// 群里可能有多位 Char 接连发言：适应用户的最近一轮，而不是把其他成员
// 的消息当作「用户的语气」，也不能在用户很久没发言时持续套旧建议。
const MAX_MESSAGES_AFTER_USER = 40;
const MAX_USER_TEXT_CHARS = 500;

const isGroupUserText = (m: Message): boolean =>
    m.role === 'user'
    && m.charId === 'user'
    && (!m.type || m.type === 'text')
    && typeof m.content === 'string'
    && Boolean(m.content.trim())
    && !/^(?:data:|https?:\/\/|blobref:)/i.test(m.content.trim());

/**
 * 群聊共享 ChatApp 的五维适应算法、每角色的 interactionAccommodation，
 * 但只从「当前群」读取用户本人文字；不读取私人聊天、其他群或角色回复。
 * 导演/轮询共用同一入口，生成的指令只约束指定成员，绝不写回角色卡/记忆。
 */
export function buildGroupMemberInteractionGuidance(
    groupMessages: Message[],
    memberName: string,
    policy?: CharacterAccommodationPolicy,
    userName = '用户',
): string {
    const recent = groupMessages.slice(-INTERACTION_TREND_MESSAGE_SCAN_LIMIT);
    let lastUserIndex = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].role === 'user' && recent[i].charId === 'user') {
            lastUserIndex = i;
            break;
        }
    }
    if (lastUserIndex < 0 || recent.length - lastUserIndex - 1 > MAX_MESSAGES_AFTER_USER) return '';
    if (!isGroupUserText(recent[lastUserIndex])) return '';

    // 保留「用户轮次」之间的角色发言边界，但绝不把他人的文本/媒体交给风格分析。
    // 非文本用户消息也作为轮次分隔，防止跨图/表情把两次发言误合并。
    const safeHistory: Message[] = recent.slice(0, lastUserIndex + 1).map(m =>
        isGroupUserText(m)
            ? { ...m, content: m.content.slice(0, MAX_USER_TEXT_CHARS) }
            : { ...m, role: 'assistant' as const, type: 'text' as const, content: '[群聊其他消息]' },
    );
    const analysis = analyzeUserInteraction(safeHistory, policy, memberName, userName);
    const guidance = renderInteractionAdaptationGuidance(analysis);
    if (!guidance) return '';

    return '\n### 【群聊交流步伐｜仅适用于 ' + memberName + '】\n'
        + '以下建议只来自本群用户「' + userName + '」的说话节奏，不代表其他成员的风格。'
        + '仅在本成员自然回应用户时酌情参考；回应群友、独立发言、选择沉默时不必模仿用户。'
        + '无论如何都要保留本成员自身的人设、立场及与用户的关系；不得让群成员共享同一种口吻。\n'
        + guidance;
}
