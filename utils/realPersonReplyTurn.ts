import { findPendingUserTurn } from './chatContinuation';

/** Filter ONLY the private-chat auto-response candidate. Music actions have
 * their own immediate bridge; app cards and rejected sends are not dialogue.
 * Keep the original chatContinuation helper untouched for other modules.
 */
type ChatTurn = {
  role: string;
  type?: string;
  metadata?: {
    musicListenInvite?: unknown;
    musicListenInviteResponseTo?: unknown;
    homeSceneRecord?: unknown;
    chatBlockRejected?: unknown;
    [key: string]: any;
  };
};
export function findPendingRealPersonUserTurn<T extends ChatTurn>(history: readonly T[]): T | null {
  const conversation = history.filter(m =>
    (m.role === 'user' || m.role === 'assistant') &&
    m.type !== 'system' && !m.metadata?.homeSceneRecord &&
    !m.metadata?.musicListenInvite && !m.metadata?.musicListenInviteResponseTo &&
    !m.metadata?.chatBlockRejected);
  return findPendingUserTurn(conversation);
}
