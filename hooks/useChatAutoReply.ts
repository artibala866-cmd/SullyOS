import { getNaturalReplyDelay } from '../utils/sullyLifeClock';
import { resolveRealPersonReplyPlan } from '../utils/realPersonReplyTiming';
import { resolveSchedulePresence } from '../utils/chatSchedulePresence';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

export const CHAT_AUTO_REPLY_DELAY_MS = 2000;

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
    pending: false, sends: new Set<symbol>(), cancelVersion: 0, firstUnansweredAt: 0,
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
        work.pending = false;
        work.firstUnansweredAt = 0;
        work.cancelVersion++;
        refresh();
    }, []);

    /** Editing after a send invalidates it, rather than resurrecting it when a draft is cleared. */
    const cancelIfPending = useCallback(() => {
        if (workRef.current.pending || workRef.current.sends.size > 0) cancel();
    }, [cancel]);

    useLayoutEffect(() => {
        workRef.current = newWork();
        refresh();
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

    // Do not surprise the user with a queued reply on returning from the background.
    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden) cancel();
            setVisible(!document.hidden);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [cancel]);

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
            }
            refresh();
        };
    }, []);

    useEffect(() => {
        const work = workRef.current;
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
            cancel();
            current.current.onGenerate();
        }, plan.delayMs);
        return () => window.clearTimeout(timer);
    }, [revision, visible, options.enabled, options.active, options.blocked, options.generating,
        options.conversationId, options.lifeActivity, options.lastCharacterReplyAt, options.naturalPacing, cancel]);

    return { beginSend, cancel, cancelIfPending };
}
