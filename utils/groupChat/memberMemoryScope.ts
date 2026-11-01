import type { CharacterProfile } from '../../types';

/** 本群关闭私聊互通时，仅为本轮群请求遮蔽私人记忆；不修改角色原档案。 */
export function groupMemberContextForSync(
    character: CharacterProfile,
    privateSyncOn: boolean,
): CharacterProfile {
    if (privateSyncOn) return character;
    return {
        ...character,
        memories: [],
        refinedMemories: {},
        activeMemoryMonths: [],
        impression: undefined,
        selfInsights: [],
        memoryPalaceEnabled: false,
        memoryPalaceInjection: '',
        roomPlatesInjection: '',
    };
}
