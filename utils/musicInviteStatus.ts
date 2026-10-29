/**
 * 一起听邀请唯一的待回应判定。
 * 回复/撤回都通过 musicListenInviteResponseTo 关联原邀请，
 * 不依赖被归档或未归档的 UI 列表。
 */
/** Only a single outstanding invitation is valid for each Char, regardless
 * of direction. A reply/cancellation is linked to the original message ID,
 * so archived messages still prevent duplicate invitations. */
export const hasPendingMusicInvite = <T extends { id?: number; metadata?: any }>(
  messages: readonly T[],
): boolean => !!findPendingMusicInvite(messages, 'user') || !!findPendingMusicInvite(messages, 'char');

export const findPendingMusicInvite = <T extends { id?: number; metadata?: any }>(
  messages: readonly T[],
  inviter: 'user' | 'char',
  messageId?: number,
): T | undefined => {
  const resolved = new Set(messages
    .map(message => message.metadata?.musicListenInviteResponseTo)
    .filter((id): id is number => Number.isInteger(id)));
  return [...messages].reverse().find(message =>
    !!message.metadata?.musicListenInvite &&
    (inviter === 'char' ? message.metadata?.inviter === 'char' : message.metadata?.inviter !== 'char') &&
    (messageId === undefined || message.id === messageId) &&
    typeof message.id === 'number' && !resolved.has(message.id) &&
    (message.metadata?.status === undefined || message.metadata?.status === 'pending'));
};
