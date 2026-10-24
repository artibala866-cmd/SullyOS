/**
 * 一起听邀请唯一的待回应判定。
 * 回复/撤回都通过 musicListenInviteResponseTo 关联原邀请，
 * 不依赖被归档或未归档的 UI 列表。
 */
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
    !resolved.has(message.id) &&
    message.metadata?.status !== 'cancelled');
};
