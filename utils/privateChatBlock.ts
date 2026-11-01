import type { CharacterProfile, PrivateChatBlockState } from '../types';

/**
 * 糯叽机拉黑框架：用户拉黑角色与角色拉黑用户是两条独立状态线。
 * 没有启用角色判定前，AI 不能靠输出普通文字自行翻转 charBlockedUserAt。
 * 纯函数用于视图、聊天本地入口与后续云端/情节系统共享判据。
 */
export type PrivateChatBlockAction = 'user-block' | 'user-unblock' | 'char-block' | 'char-unblock' | 'allow-char-block' | 'disallow-char-block';
export type PrivateChatBlockDirection = 'none' | 'user' | 'char' | 'both';
export const getPrivateChatBlock = (char?: Pick<CharacterProfile, 'privateChatBlock'> | null): PrivateChatBlockState =>
    char?.privateChatBlock ?? {};

export const isUserBlockingChar = (char?: Pick<CharacterProfile, 'privateChatBlock'> | null): boolean =>
    Number(getPrivateChatBlock(char).userBlockedAt) > 0;

export const isCharBlockingUser = (char?: Pick<CharacterProfile, 'privateChatBlock'> | null): boolean =>
    Number(getPrivateChatBlock(char).charBlockedUserAt) > 0;

export const canCharBlockUser = (char?: Pick<CharacterProfile, 'privateChatBlock'> | null): boolean =>
    getPrivateChatBlock(char).allowCharBlockUser !== false;

export const privateChatBlockDirection = (char?: Pick<CharacterProfile, 'privateChatBlock'> | null): PrivateChatBlockDirection => {
    const user = isUserBlockingChar(char), other = isCharBlockingUser(char);
    return user && other ? 'both' : user ? 'user' : other ? 'char' : 'none';
};

export const isPrivateChatConversationBlocked = (char?: Pick<CharacterProfile, 'privateChatBlock'> | null): boolean =>
    privateChatBlockDirection(char) !== 'none';

export const transitionPrivateChatBlock = (
    previous: PrivateChatBlockState | undefined,
    action: PrivateChatBlockAction,
    at = Date.now(),
    reason?: string,
): PrivateChatBlockState => {
    const current = previous ?? {};
    const next = { ...current };
    const time = Number.isFinite(at) && at > 0 ? Math.floor(at) : Date.now();
    switch (action) {
        case 'user-block':
            if (!next.userBlockedAt) next.userBlockedAt = time;
            break;
        case 'user-unblock':
            if (next.userBlockedAt) { next.userBlockedAt = null; next.userUnblockedAt = time; }
            break;
        case 'char-block':
            // 原版许可关闭时，角色不能拉黑；不影响用户对角色的拉黑。
            if (next.allowCharBlockUser !== false && !next.charBlockedUserAt) {
                next.charBlockedUserAt = time;
                next.charBlockedUserReason = typeof reason === 'string' ? reason.slice(0, 500) : '';
            }
            break;
        case 'char-unblock':
            if (next.charBlockedUserAt) {
                next.charBlockedUserAt = null;
                next.charUnblockedUserAt = time;
            }
            break;
        case 'allow-char-block':
            next.allowCharBlockUser = true;
            break;
        case 'disallow-char-block':
            next.allowCharBlockUser = false;
            // 与糯叽机“关掉会顺便解除拉黑”的原版规则一致。
            if (next.charBlockedUserAt) { next.charBlockedUserAt = null; next.charUnblockedUserAt = time; }
            break;
    }
    return next;
};
