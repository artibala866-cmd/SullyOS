/**
 * Notify the music page and other tabs only AFTER the atomic chat deletion
 * has committed. IndexedDB is the source of truth; the event carries no
 * guessed accepted/declined state.
 */
import type { Message } from '../types';
import { announceMusicInviteDbChanged } from './musicInviteStatus';

type Invitation = Pick<Message, 'id' | 'charId' | 'metadata'>;
export const notifyDeletedMusicInviteCards = (
  charId: string, messages: readonly Invitation[],
): void => {
  if (!messages.some(m => m.charId === charId && m.metadata?.musicListenInvite)) return;
  announceMusicInviteDbChanged(charId);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('music-listen-invite-resolved', {
    detail: { charId },
  }));
};
