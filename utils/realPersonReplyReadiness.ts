import { COMPOSER_SETTLE_MS } from './chatComposerActivity';
import type { RealPersonAttention } from './realPersonReplyRhythm';

/**
 * Availability decision for a REPLY TO A REAL, SAVED USER TURN.
 * This is NOT a periodic clock, an AMSG wake, or a probability that the model
 * should manufacture a topic. An actual user event arms the work. The existing
 * DB-tail gate checks that the turn still needs an answer.
 *
 * Time is used only for the composer to become quiet (typing/debounce) and
 * for retries after technical failures. Character time ranges are legacy
 * settings and must never independently initiate a reply.
 */
export type RealPersonReplyReadiness =
    | { kind: 'ready'; settleMs: number }
    | { kind: 'wait-availability'; settleMs: 0 };

export function resolveRealPersonReplyReadiness(args: {
    activity: 'sleep' | 'busy' | 'free' | null;
    attention?: RealPersonAttention;
    now: number;
    lastComposerActivityAt?: number;
    lastUserSendAt?: number;
}): RealPersonReplyReadiness {
    // Reference input-ended mode: schedule is context, not a second reply timer.
    // A saved user turn waits for live composer release, not an empty diary slot.
    const now = Number.isFinite(args.now) ? args.now : 0;
    const lastEdit = Number.isFinite(args.lastComposerActivityAt)
        ? args.lastComposerActivityAt! : 0;
    const lastSend = Number.isFinite(args.lastUserSendAt)
        ? args.lastUserSendAt! : 0;
    const lastInteraction = Math.max(lastEdit, lastSend);
    // Short composer settling is not a "time to speak" schedule: only
    // recently edited/saved text needs this pause to let a user finish a burst.
    // No composer event means immediate eligibility, never a cold-chat timer.
    const settleMs = lastInteraction > 0
        ? Math.max(0, COMPOSER_SETTLE_MS - Math.max(0, now - lastInteraction))
        : 0;
    return { kind: 'ready', settleMs };
}
