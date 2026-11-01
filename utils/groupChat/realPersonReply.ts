/** Group chat reuses the private-chat real-person attention evidence and durable
 * reply intent; it must never invent a second group reply engine or clock.
 * Only a genuine persisted user turn may arm automatic group generation.
 */
import { findPendingRealPersonUserTurn } from '../realPersonReplyTurn';
import { resolveRealPersonAttention } from '../realPersonReplyRhythm';

export type GroupRealTurn = {
    id: number | string;
    role: string;
    type?: string;
    timestamp?: number;
    metadata?: any;
};

export function resolveGroupRealPersonReplyState(messages: readonly GroupRealTurn[], now: number) {
    // Ignore system/scene cards for conversational attention. The pending-user
    // selector also excludes rejected sends and invitation side-channels.
    const conversational = messages.filter(m =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.type !== 'system' && !m.metadata?.homeSceneRecord &&
        !m.metadata?.musicListenInvite && !m.metadata?.musicListenInviteResponseTo &&
        !m.metadata?.chatBlockRejected);
    const pending = findPendingRealPersonUserTurn(conversational);
    const lastAnswer = [...conversational].reverse().find(m =>
        m.role === 'assistant' && m.metadata?.activeMsg2?.taskId == null &&
        typeof m.timestamp === 'number' && Number.isFinite(m.timestamp) &&
        m.timestamp > 0 && m.timestamp <= now);
    // A group has no single member schedule: do NOT infer sleep, work or
    // online presence from another member's profile or the device clock.
    const replyAttention = resolveRealPersonAttention(
        [...conversational, { id: 'candidate', role: 'user', type: 'text', timestamp: now }],
        now, null);
    return { pendingId: pending?.id ?? null, lastCharacterReplyAt: lastAnswer?.timestamp ?? 0, replyAttention };
}
