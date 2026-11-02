import { chatComposerWaitMs, COMPOSER_ACTIVITY_CHANGED } from '../utils/chatComposerActivity';
import { resolveRealPersonReplyReadiness } from '../utils/realPersonReplyReadiness';
import { REAL_PERSON_RHYTHM_STATES, type RealPersonAttention } from '../utils/realPersonReplyRhythm';
import { CHAT_AUTO_REPLY_REVOKE_REVISION_KEY } from '../utils/chatInputPreferences';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

export const CHAT_AUTO_REPLY_DELAY_MS = 2000;
/** Waiting through sleep is not a reason to forget a saved user turn. */
export const CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS = 48 * 60 * 60_000;
export const CHAT_AUTO_REPLY_INTENT_PREFIX = 'sully_chat_auto_reply_intent_v1:';
const intentKey = (id: string) => id.startsWith('group:')
    ? 'sully_group_auto_reply_intent_v1:' + id.slice(6) : CHAT_AUTO_REPLY_INTENT_PREFIX + id;

/** The local intent is not a second reply engine or a second billable request. */
type ReplyIntent = { firstUnansweredAt: number; lastUserSendAt: number; replyAttention?: RealPersonAttention };
function readIntentState(charId: string, now = Date.now()): ReplyIntent | null {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(intentKey(charId)) || 'null');
        const data = raw as Partial<ReplyIntent> | null;
        const at = data?.firstUnansweredAt;
        if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now ||
            now - at >= CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS) {
            localStorage.removeItem(intentKey(charId));
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
        localStorage.setItem(intentKey(charId), JSON.stringify({ firstUnansweredAt: at, lastUserSendAt, replyAttention }));
        return true;
    } catch { return false; }
}
function removeIntent(charId: string, expectedAt: number): void {
    try {
        // A stale tab must not erase a newer conversation's intent.
        if (readIntent(charId) === expectedAt) localStorage.removeItem(intentKey(charId));
    } catch { /* Storage is optional; in-memory auto-reply still works. */ }
}

interface Options {
    enabled: boolean;
    persistenceScope?: 'private' | 'group';
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
    /** Latest user text-edit event; clearing a draft needs its own quiet window. */
    lastComposerActivityAt?: number;
}

const newWork = () => ({
    pending: false, sends: new Set<symbol>(), cancelVersion: 0, firstUnansweredAt: 0, persisted: false,
    checking: false, retryAt: 0, lastUserSendAt: 0, replyAttention: undefined as RealPersonAttention | undefined, ownerId: null as string | null, storageId: null as string | null,
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
            removeIntent(work.storageId || work.ownerId, work.firstUnansweredAt);
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
        work.storageId = options.conversationId && (options.persistenceScope === 'group' ? 'group:' : '') + options.conversationId;
        if (options.conversationId) {
            if (!options.enabled) {
                const old = readIntent(work.storageId!);
                if (old) removeIntent(work.storageId!, old);
            } else if (options.active) {
                const saved = readIntentState(work.storageId!);
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
    }, [options.conversationId, options.enabled, options.active, options.persistenceScope]);

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
        window.addEventListener(COMPOSER_ACTIVITY_CHANGED, onResume);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pageshow', onResume);
            window.removeEventListener('focus', onResume);
            window.removeEventListener(COMPOSER_ACTIVITY_CHANGED, onResume);
        };
    }, []);

    const beginSend = useCallback((conversationId: string | null) => {
        if (!current.current.enabled || !current.current.active ||
            conversationId !== current.current.conversationId) return (_sent: boolean) => {};
        const work = workRef.current;
        work.ownerId = conversationId;
        work.storageId = conversationId && (current.current.persistenceScope === 'group' ? 'group:' : '') + conversationId;
        const token = Symbol();
        const version = work.cancelVersion;
        const groupScope = current.current.persistenceScope === 'group';
        const optOutRevision = readOptOutRevision();
        work.sends.add(token);
        refresh();
        return (sent: boolean) => {
            if (!work.sends.delete(token)) return;
            if (sent && version === work.cancelVersion && current.current.enabled &&
                (groupScope || optOutRevision === readOptOutRevision())) {
                // The IndexedDB save can resolve after Char switches or Chat
                // unmounts. Persist ONLY the successful send for its original Char.
                // Cancellation while saving still invalidates this callback.
                const savedAt = readIntent(work.storageId!) ||
                    (work.pending ? work.firstUnansweredAt : Date.now());
                // Two saves can complete inside one millisecond. This is a
                // per-intent revision boundary, not merely a wall-clock sample;
                // it must change on EVERY confirmed new send to stop a previous
                // generation from consuming a newer user turn.
                const lastUserSendAt = Math.max(Date.now(), work.lastUserSendAt + 1);
                const replyAttention = work.pending ? work.replyAttention : current.current.replyAttention;
                const stored = persistIntent(work.storageId!, savedAt, lastUserSendAt, replyAttention);
                if (workRef.current !== work) {
                    // A newly mounted/returned surface may already be showing
                    // this same Char; hydrate it without resetting its work.
                    const currentWork = workRef.current;
                    if (stored && current.current.conversationId === conversationId &&
                        current.current.active && !currentWork.pending) {
                        currentWork.ownerId = conversationId;
                        currentWork.storageId = work.storageId;
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
                !document.hidden && (!latest.naturalPacing || !work.ownerId || chatComposerWaitMs(work.ownerId) !== Infinity);
        };
        if (!visible || !ready()) return;
        const latest = current.current;
        const now = Date.now();
        // A real-person reply is driven by the successful USER SEND and
        // actual availability, NOT a sampled 4-6 minute character timer.
        // Busy/sleep wake through the existing schedule change signals.
        const readiness = latest.naturalPacing
            ? resolveRealPersonReplyReadiness({
                activity: latest.lifeActivity ?? null,
                attention: work.replyAttention === 'occupied' && latest.lifeActivity === 'free'
                    ? (latest.replyAttention || 'normal') : work.replyAttention || latest.replyAttention,
                now,
                lastComposerActivityAt: latest.lastComposerActivityAt,
                lastUserSendAt: work.lastUserSendAt,
            })
            : { kind: 'ready' as const, settleMs: Math.max(
                CHAT_AUTO_REPLY_DELAY_MS,
                latest.lastComposerActivityAt && now >= latest.lastComposerActivityAt
                    ? Math.max(0, 2_800 - (now - latest.lastComposerActivityAt))
                    : 0,
            ) };
        if (readiness.kind === 'wait-availability') return;
        // Technical retries have their own backoff; their wake does not count
        // as a conversational reason to generate. The pending USER TURN does.
        const delay = Math.max(readiness.settleMs, work.retryAt - now,
            latest.naturalPacing && work.ownerId ? chatComposerWaitMs(work.ownerId, now) : 0);
        let disposed = false;
        const dispatch = () => {
            if (disposed) return;
            if (!ready()) return;
            const currentId = current.current.conversationId;
            if (!currentId) return;
            const run = (): Promise<void> => {
                if (!ready()) return Promise.resolve();
                if (work.persisted && readIntent(work.storageId || currentId) !== work.firstUnansweredAt) {
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
                    // A newer, actually saved user message may arrive WHILE the
                    // old request is generating. Its saved intent belongs to
                    // another user-turn boundary; the old completion may not
                    // acknowledge or delete it, regardless of old outcome.
                    if (work.lastUserSendAt !== latestSendBoundary) {
                        work.retryAt = Date.now() + 1_500;
                        refresh();
                        return;
                    }
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
                        (!current.current.naturalPacing || chatComposerWaitMs(currentId) === 0) &&
                        (!work.persisted || readIntent(work.storageId || currentId) === work.firstUnansweredAt);
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
        };
        // No artificial countdown for real-person chats. Yield one microtask
        // for React's post-send UI reconciliation and then verify the DB tail.
        // A timeout is used ONLY if typing just ended or a DB retry backs off.
        if (delay > 0) {
            const timer = window.setTimeout(dispatch, delay);
            return () => { disposed = true; window.clearTimeout(timer); };
        }
        void Promise.resolve().then(dispatch);
        return () => { disposed = true; };
    }, [revision, visible, options.enabled, options.active, options.blocked, options.generating,
        options.conversationId, options.lifeActivity, options.lastCharacterReplyAt, options.naturalPacing,
        options.replyAttention, options.lastComposerActivityAt, cancel]);

    return { beginSend, cancel, cancelIfPending };
}
