/**
 * Invitation-only deletion guard. Settle pending cards via the existing
 * IndexedDB transaction before removing them from chat history.
 * Invisible cancellation receipts prevent an in-flight older AI response
 * from joining after its invitation card has disappeared.
 * Ordinary chat records and established listening sessions are untouched.
 */
import type { Message } from '../types';
import { DB } from './db';
import { announceMusicInviteDbChanged } from './musicInviteStatus';

type Invitation = Pick<Message, 'id' | 'charId' | 'metadata'>;

export const settleDeletedMusicInviteCards = async (
  charId: string, messages: readonly Invitation[],
): Promise<void> => {
  for (const message of messages) {
    if (message.charId !== charId || !message.metadata?.musicListenInvite) continue;
    const inviter = message.metadata.inviter === 'char' ? 'char' : 'user';
    const settled = await DB.resolveMusicListeningInvite(charId, inviter, {
      charId, role: 'user', type: 'system',
      content: '[一起听邀请] 邀请卡片已删除。',
      metadata: { accepted: false, cancelled: true, musicInviteDeleted: true, inviter },
    }, message.id);
    if (settled.resolved) {
      announceMusicInviteDbChanged(charId);
      typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('music-listen-invite-resolved', {
        detail: { charId, messageId: message.id, accepted: false },
      }));
    }
  }
};

export const notifyDeletedMusicInviteCards = (
  charId: string, messages: readonly Invitation[],
): void => {
  if (!messages.some(m => m.charId === charId && m.metadata?.musicListenInvite)) return;
  announceMusicInviteDbChanged(charId);
  typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent('music-listen-invite-resolved', {
    detail: { charId },
  }));
};
