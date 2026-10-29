import { getNaturalReplyDelay } from '../utils/sullyLifeClock';
import { resolveRealPersonReplyPlan } from '../utils/realPersonReplyTiming';
import { resolveSchedulePresence } from '../utils/chatSchedulePresence';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

export const CHAT_AUTO_REPLY_DELAY_MS = 2000;
/** Waiting through sleep is not a reason to forget a saved user turn. */
export const CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS = 48 * 60 * 60_000;
export const CHAT_AUTO_REPLY_INTENT_PREFIX = 'sully_chat_auto_reply_intent_v1:';

/** The local intent is not a second reply engine or a second billable request. */
function readIntent(charId: string, now = Date.now()): number {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId) || 'null');
        const at = (raw as { firstUnansweredAt?: unknown } | null)?.firstUnansweredAt;
        if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > now ||
            now - at >= CHAT_AUTO_REPLY_MAX_PENDING_AGE_MS) {
            localStorage.removeItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId);
            return 0;
        }
        return at;
    } catch { return 0; }
}
function persistIntent(charId: string, at: number): boolean {
    try {
        localStorage.setItem(CHAT_AUTO_REPLY_INTENT_PREFIX + charId, JSON.stringify({ firstUnansweredAt: at }));
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
    onGenerate: () => void;
    naturalPacing?: boolean;
    lifeActivity?: 'sleep' | 'busy' | 'free' | null;
    lastCharacterReplyAt?: number;
}

const newWork = () => ({
    pending: false, sends: new Set<symbol>(), cancelVersion: 0, firstUnansweredAt: 0, persisted: false,
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
        if (work.pending && work.persisted && current.current.conversationId)
            removeIntent(current.current.conversationId, work.firstUnansweredAt);
        work.pending = false;
        work.persisted = false;
        work.firstUnansweredAt = 0;
        work.cancelVersion++;
        refresh();
    }, []);

    /** Editing after a send invalidates it, rather than resurrecting it when a draft is cleared. */
    const cancelIfPending = useCallback(() => {
        if (workRef.current.pending || workRef.current.sends.size > 0) cancel();
    }, [cancel]);

    useLayoutEffect(() => {
        const work = newWork();
        if (options.conversationId) {
            if (!options.enabled) {
                const old = readIntent(options.conversationId);
                if (old) removeIntent(options.conversationId, old);
            } else if (options.active) {
                const savedAt = readIntent(options.conversationId);
                if (savedAt) {
                    work.pending = true;
                    work.persisted = true;
                    work.firstUnansweredAt = savedAt;
                }
            }
        }
        workRef.current = work;
        refresh();
        // Unmount / changing the active surface does not revoke a saved user send.
        return () => { workRef.current = newWork(); };
    }, [options.conversationId, options.enabled, options.active]);

    // Manual lightning or a remote/local generation already owns this turn.
    useLayoutEffect(() => {
        if (options.generating) cancel();
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
        const token = Symbol();
        const version = work.cancelVersion;
        work.sends.add(token);
        refresh();
        return (sent: boolean) => {
            if (workRef.current !== work || !work.sends.delete(token)) return;
            if (sent && version === work.cancelVersion) {
                if (!work.pending) work.firstUnansweredAt = Date.now();
                work.pending = true;
                work.persisted = persistIntent(conversationId!, work.firstUnansweredAt);
            }
            refresh();
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
            return workRef.current === work && work.pending && work.sends.size === 0 &&
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
                activity: presence === 'online' && activity !== null ? 'free' : activity,
                firstUnansweredAt: work.firstUnansweredAt,
                now,
                fallbackDelayMs: getNaturalReplyDelay(latest.conversationId || ''),
            })
            : { delayMs: CHAT_AUTO_REPLY_DELAY_MS };
        if (plan.delayMs === null) {
            // Sleep is not unlocked by repeated nudges; reconsider when the real schedule changes.
            const recheck = window.setTimeout(() => refresh(), 60_000);
            return () => window.clearTimeout(recheck);
        }
        // Internal delay only: no countdown state, per-second renders or pre-reply status bar.
        const timer = window.setTimeout(() => {
            if (!ready()) return;
            const currentId = current.current.conversationId;
            // Cross-tab best effort: a reply already claimed elsewhere must not
            // be started again. The existing chat lock and DB speaker check remain.
            if (work.persisted && currentId && readIntent(currentId) !== work.firstUnansweredAt) {
                work.pending = false;
                work.persisted = false;
                refresh();
                return;
            }
            cancel();
            current.current.onGenerate();
        }, plan.delayMs);
        return () => window.clearTimeout(timer);
    }, [revision, visible, options.enabled, options.active, options.blocked, options.generating,
        options.conversationId, options.lifeActivity, options.lastCharacterReplyAt, options.naturalPacing, cancel]);

    return { beginSend, cancel, cancelIfPending };
}
