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


/**
 * Persist an outgoing withdrawal only for a genuinely pending DB invitation.
 * The caller changes local UI state only after this operation commits.
 * Returning null means the cached "pending" flag was stale or already resolved.
 */
export const persistMusicInviteWithdrawal = async <T extends { id?: number; metadata?: any }>(
  charId: string,
  requestedMessageId: number | undefined,
  readHistory: (charId: string) => Promise<readonly T[]>,
  saveResponse: (response: {
    charId: string; role: 'user'; type: 'system'; content: string;
    metadata: { musicListenInviteResponseTo: number; accepted: false; cancelled: true };
  }) => Promise<unknown>,
): Promise<number | null> => {
  const messages = await readHistory(charId);
  const pending = findPendingMusicInvite(messages, 'user', requestedMessageId);
  if (typeof pending?.id !== 'number') return null;
  await saveResponse({
    charId, role: 'user', type: 'system',
    content: '[一起听邀请] 我撤回了邀请。',
    metadata: { musicListenInviteResponseTo: pending.id, accepted: false, cancelled: true },
  });
  return pending.id;
};

/** Cross-tab notification only. IndexedDB stays the source of truth. */
export const MUSIC_INVITE_DB_CHANGED_KEY = 'sully_music_invite_db_changed_v1';

export const announceMusicInviteDbChanged = (charId: string): void => {
  try {
    // A unique value makes repeated updates observable by other tabs.
    localStorage.setItem(MUSIC_INVITE_DB_CHANGED_KEY, JSON.stringify({
      charId, at: Date.now(), nonce: Math.random(),
    }));
  } catch { /* In-page events still work when storage is blocked. */ }
};

export const musicInviteChangedCharId = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const decoded: unknown = JSON.parse(value);
    if (!decoded || typeof decoded !== 'object') return null;
    const id = (decoded as { charId?: unknown }).charId;
    return typeof id === 'string' && id.length > 0 && id.length < 256 ? id : null;
  } catch { return null; }
};

/**
 * A Char MUSIC_ACTION may voluntarily join without a pending invitation.
 * However, if the user's most recent invitation was already withdrawn or
 * answered, a delayed AI "accept" from that OLD turn must not resurrect it.
 * A later ordinary user turn is a new opportunity for a voluntary join.
 */
export const canJoinMusicWithoutPendingInvite = <
  T extends { id?: number; role?: string; type?: string; metadata?: any }
>(messages: readonly T[]): boolean => {
  const ordered = [...messages].filter(m => typeof m.id === 'number')
    .sort((a, b) => (a.id as number) - (b.id as number));
  const lastOutgoing = [...ordered].reverse().find(m =>
    m.metadata?.musicListenInvite && m.metadata?.inviter !== 'char');
  if (!lastOutgoing) return true;
  const resolution = ordered.find(m =>
    m.metadata?.musicListenInviteResponseTo === lastOutgoing.id);
  if (!resolution) return false; // A pending invite needs its actual resolution.
  return ordered.some(m => (m.id as number) > (resolution.id as number) &&
    m.role === 'user' && m.type !== 'system' &&
    !m.metadata?.musicListenInvite && !m.metadata?.musicListenInviteResponseTo);
};
