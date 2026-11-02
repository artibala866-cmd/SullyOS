import { resolveRealPersonReplyPlan } from '../utils/realPersonReplyTiming';
import { REAL_PERSON_RHYTHM_STATES, type RealPersonAttention, type RealPersonReplyRhythm } from '../utils/realPersonReplyRhythm';
import { resolveSchedulePresence } from '../utils/chatSchedulePresence';
import { CHAT_AUTO_REPLY_REVOKE_REVISION_KEY } from '../utils/chatInputPreferences';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

export const CHAT_AUTO_REPLY_DELAY_MS = 2000;
/** Waiting through sleep is not a reason to forget a saved user turn. */
export const CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS = 48 * 60 * 60_000;
export const CHAT_AUTO_REPLY_INTENT_PREFIX = 'sully_chat_auto_reply_intent_v1:';

/** The local intent is not a second reply engine or a second billable request. */
type ReplyIntent = { firstUnansweredAt: number; lastUserSendAt: number; replyAttention?: RealPersonAttention };
function readIntentState(charId: string, now = Date.now()): ReplyIntent | null {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId) || 'null');
        const data = raw as Partial<ReplyIntent> | null;
        const at = data?.firstUnansweredAt;
        if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now ||
            now - at >= CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS) {
            localStorage.removeItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId);
            return null;
        }
        const last = data?.lastUserSendAt;
        return { firstUnansweredAt: at,
            lastUserSendAt: typeof last === 'number' && Number.isFinite(last)
                ? Math.max(at, Math.min(last, now)) : at,
            replyAttention: REAL_PERSON_RHYTHM_STATES.includes(data?.replyAttention as RealPersonAttention)
                ? data?.replyAttention : undefined };
    } catch { return null; }
}
function readIntent(charId: string, now = Date.now()): number {
    return readIntentState(charId, now)?.firstUnansweredAt ?? 0;
}
function readOptOutRevision(): string | null {
    try { return localStorage.getItem(CHAT_AUTO_REPLY_REVOKE_REVISION_KEY); }
    catch { return null; }
}
function persistIntent(charId: string, at: number, lastUserSendAt = at, replyAttention?: RealPersonAttention): boolean {
    try {
        localStorage.setItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId, JSON.stringify({ firstUnansweredAt: at, lastUserSendAt, replyAttention }));
        return true;
    } catch { return false; }
}
function removeIntent(charId: string, expectedAt: number): void {
    try {
        // A stale tab must not erase a newer conversation's intent.
        if (readIntent(charId) === expectedAt) localStorage.removeItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId);
    } catch { /* Storage is optional; in-memory auto-reply still works. */ }
}

interface Options {
    enabled: boolean;
    conversationId: string | null;
    active: boolean;
    blocked: boolean;
    generating: boolean;
    /** retry means prerequisites are transiently unavailable; discard means the turn was resolved/withdrawn. */
    onGenerate: (stillEligible?: () => boolean) => void | 'retry' | 'discard' | Promise<void | 'retry' | 'discard'>;
    naturalPacing?: boolean;
    lifeActivity?: 'sleep' | 'busy' | 'free' | null;
    lastCharacterReplyAt?: number;
    replyAttention?: RealPersonAttention;
    replyRhythm?: Partial<RealPersonReplyRhythm>;
    /** Latest user text-edit event; clearing a draft needs its own quiet window. */
    lastComposerActivityAt?: number;
}

const newWork = () => ({
    pending: false, sends: new Set<symbol>(), cancelVersion: 0, firstUnansweredAt: 0, persisted: false,
    checking: false, retryAt: 0, lastUserSendAt: 0, replyAttention: undefined as RealPersonAttention | undefined, ownerId: null as string | null,
});

/** Only a successfully saved send in this active conversation creates a candidate. */
export function useChatAutoReply(options: Options) {
    const current = useRef(options);
    useLayoutEffect(() => { current.current = options; });
    const workRef = useRef(newWork());
    const [revision, refresh] = useReducer(n => n + 1, 0);
    const [visible, setVisible] = useState(() => !document.hidden);

    const cancel = useCallback(() => {
        const work = workRef.current;
        if (work.pending && work.persisted && work.ownerId)
            removeIntent(work.ownerId, work.firstUnansweredAt);
        work.pending = false;
        work.checking = false;
        work.persisted = false;
        work.firstUnansweredAt = 0;
        work.replyAttention = undefined;
        work.cancelVersion++;
        refresh();
    }, []);

    /** Editing after a send invalidates it, rather than resurrecting it when a draft is cleared. */
    const cancelIfPending = useCallback(() => {
        if (workRef.current.pending || workRef.current.sends.size > 0) cancel();
    }, [cancel]);

    useLayoutEffect(() => {
        const work = newWork();
        work.ownerId = options.conversationId;
        if (options.conversationId) {
            if (!options.enabled) {
                const old = readIntent(options.conversationId);
                if (old) removeIntent(options.conversationId, old);
            } else if (options.active) {
                const saved = readIntentState(options.conversationId);
                if (saved) {
                    work.pending = true;
                    work.persisted = true;
                    work.firstUnansweredAt = saved.firstUnansweredAt;
                    work.lastUserSendAt = saved.lastUserSendAt;
                    work.replyAttention = saved.replyAttention;
                }
            }
        }
        workRef.current = work;
        refresh();
        // Unmount / changing the active surface does not revoke a saved user send.
        return () => { workRef.current = newWork(); };
    }, [options.conversationId, options.enabled, options.active]);

    // A manually-started reply supersedes the pending auto candidate. However,
    // the auto callback itself starts the same useChatAI typing indicator:
    // cancelling its own in-flight candidate here would erase the durable
    // reply intent BEFORE the API result is known. Only external generations
    // (with no auto verification already in flight) revoke it.
    useLayoutEffect(() => {
        if (options.generating && !workRef.current.checking) cancel();
    }, [options.generating, cancel]);

    // A truly persisted Char/AMSG reply after this send also consumes the pending candidate.
    useLayoutEffect(() => {
        const work = workRef.current;
        if (work.pending && work.firstUnansweredAt > 0 &&
            Number.isFinite(options.lastCharacterReplyAt) &&
            (options.lastCharacterReplyAt ?? 0) >= work.firstUnansweredAt) cancel();
    }, [options.lastCharacterReplyAt, cancel]);

    // The OS can pause timers, but leaving the screen is not a cancellation.
    useEffect(() => {
        const onVisibility = () => {
            setVisible(!document.hidden);
            if (!document.hidden) refresh();
        };
        const onResume = () => { if (!document.hidden) refresh(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pageshow', onResume);
        window.addEventListener('focus', onResume);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pageshow', onResume);
            window.removeEventListener('focus', onResume);
        };
    }, []);

    const beginSend = useCallback((conversationId: string | null) => {
        if (!current.current.enabled || !current.current.active ||
            conversationId !== current.current.conversationId) return (_sent: boolean) => {};
        const work = workRef.current;
        work.ownerId = conversationId;
        const token = Symbol();
        const version = work.cancelVersion;
        const optOutRevision = readOptOutRevision();
        work.sends.add(token);
        refresh();
        return (sent: boolean) => {
            if (!work.sends.delete(token)) return;
            if (sent && version === work.cancelVersion && current.current.enabled &&
                optOutRevision === readOptOutRevision()) {
                // The IndexedDB save can resolve after Char switches or Chat
                // unmounts. Persist ONLY the successful send for its original Char.
                // Cancellation while saving still invalidates this callback.
                const savedAt = readIntent(conversationId!) ||
                    (work.pending ? work.firstUnansweredAt : Date.now());
                const lastUserSendAt = Date.now();
                const replyAttention = work.pending ? work.replyAttention : current.current.replyAttention;
                const stored = persistIntent(conversationId!, savedAt, lastUserSendAt, replyAttention);
                if (workRef.current !== work) {
                    // A newly mounted/returned surface may already be showing
                    // this same Char; hydrate it without resetting its work.
                    const currentWork = workRef.current;
                    if (stored && current.current.conversationId === conversationId &&
                        current.current.active && !currentWork.pending) {
                        currentWork.ownerId = conversationId;
                        currentWork.pending = true;
                        currentWork.persisted = true;
                        currentWork.firstUnansweredAt = savedAt;
                        currentWork.lastUserSendAt = lastUserSendAt;
                        currentWork.replyAttention = replyAttention;
                        refresh();
                    }
                    return;
                }
                if (!work.pending) work.firstUnansweredAt = savedAt;
                work.lastUserSendAt = lastUserSendAt;
                work.replyAttention = replyAttention;
                work.pending = true;
                work.persisted = stored;
            }
            if (workRef.current === work) refresh();
        };
    }, []);

    useEffect(() => {
        const work = workRef.current;
        // Intent survives a night of sleep, but an abandoned one has a finite lifetime.
        if (work.pending && work.firstUnansweredAt > 0 &&
            Date.now() - work.firstUnansweredAt >= CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS) {
            cancel();
            return;
        }
        const ready = () => {
            const latest = current.current;
            return workRef.current === work && work.pending && !work.checking && work.sends.size === 0 &&
                latest.enabled && latest.active && !latest.blocked && !latest.generating &&
                !document.hidden;
        };
        if (!visible || !ready()) return;
        const latest = current.current;
        const now = Date.now();
        const activity = latest.lifeActivity ?? null;
        const presence = resolveSchedulePresence(activity, latest.lastCharacterReplyAt, now);
        const plan = latest.naturalPacing
            ? resolveRealPersonReplyPlan({
                activity: activity === 'sleep' ? 'sleep' : presence === 'online' && activity !== null ? 'free' : activity,
                firstUnansweredAt: work.firstUnansweredAt,
                now,
                // Unknown schedule is NOT evidence of sleep or office hours.
                fallbackDelayMs: 3_500,
                lastUserSendAt: work.lastUserSendAt,
                lastCharacterReplyAt: latest.lastCharacterReplyAt,
                replyAttention: work.replyAttention === 'occupied' && activity === 'free'
                    ? (latest.replyAttention || 'normal') : work.replyAttention || latest.replyAttention,
                replyRhythm: latest.replyRhythm,
                characterId: latest.conversationId || '',
            })
            : { delayMs: CHAT_AUTO_REPLY_DELAY_MS };
        if (plan.delayMs === null) {
            // Sleep is not unlocked by repeated nudges; reconsider when the real schedule changes.
            const recheck = window.setTimeout(() => refresh(), 60_000);
            return () => window.clearTimeout(recheck);
        }
        // Never consume a durable intent until the existing Chat route has
        // checked the canonical DB tail. Visibility can change during that read.
        // A cleared composer is not the same as finished input. An old saved
        // user turn might already be minutes overdue; wait until real editing
        // has stopped before dispatching it (APK-style compose-settle gate).
        const lastEditAt = Number(latest.lastComposerActivityAt) || 0;
        const quietAfterEdit = lastEditAt > 0 && now >= lastEditAt
            ? Math.max(0, 2_800 - (now - lastEditAt)) : 0;
        const timer = window.setTimeout(() => {
            if (!ready()) return;
            const currentId = current.current.conversationId;
            if (!currentId) return;
            const run = (): Promise<void> => {
                if (!ready()) return Promise.resolve();
                if (work.persisted && readIntent(currentId) !== work.firstUnansweredAt) {
                    work.pending = false;
                    work.persisted = false;
                    refresh();
                    return Promise.resolve();
                }
                work.checking = true;
                const version = work.cancelVersion;
                const latestSendBoundary = work.lastUserSendAt;
                const settle = (outcome: void | 'retry' | 'discard') => {
                    if (workRef.current !== work || version !== work.cancelVersion) return;
                    work.checking = false;
                    if (outcome === 'retry') {
                        // Back off a temporarily unavailable local DB / hidden page;
                        // do not launch a second paid request to make up for it.
                        work.retryAt = Date.now() + 15_000;
                        refresh();
                    } else cancel();
                };
                try {
                    const stillEligible = () => workRef.current === work && work.pending &&
                        work.cancelVersion === version && work.sends.size === 0 &&
                        work.lastUserSendAt === latestSendBoundary && current.current.conversationId === currentId &&
                        current.current.enabled && current.current.active && !current.current.generating &&
                        !current.current.blocked && !document.hidden &&
                        (!work.persisted || readIntent(currentId) === work.firstUnansweredAt);
                    const result = current.current.onGenerate(stillEligible);
                    if (result && typeof (result as Promise<unknown>).then === 'function') {
                        return Promise.resolve(result).then(settle, () => settle('discard'));
                    }
                    settle(result as void | 'retry' | 'discard');
                } catch { settle('discard'); }
                return Promise.resolve();
            };
            // Serialize checks across tabs when the WebView offers Web Locks.
            // Older platforms still use the persisted intent + existing Chat guard.
            const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
            if (locks?.request) {
                void locks.request('sully-chat-auto-reply:' + currentId,
                    { mode: 'exclusive' }, () => run()).catch(() => { if (workRef.current === work && work.checking) cancel(); });
            } else void run();
        }, Math.max(plan.delayMs, work.retryAt - now, quietAfterEdit));
        return () => window.clearTimeout(timer);
    }, [revision, visible, options.enabled, options.active, options.blocked, options.generating,
        options.conversationId, options.lifeActivity, options.lastCharacterReplyAt, options.naturalPacing,
        options.replyAttention, options.replyRhythm, options.lastComposerActivityAt, cancel]);

    return { beginSend, cancel, cancelIfPending };
}
