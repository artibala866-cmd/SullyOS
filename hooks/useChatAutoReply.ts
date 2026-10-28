import { getNaturalReplyDelay } from '../utils/sullyLifeClock';
import { resolveRealPersonReplyPlan } from '../utils/realPersonReplyTiming';
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
}

const newWork = () => ({
    pending: false, sends: new Set<symbol>(), cancelVersion: 0,
    nudgeScore: 0, firstUnansweredAt: 0,
});

/** 只处理本次聊天实际发送的消息；历史加载、切角色和取消都不会补触发。 */
export function useChatAutoReply(options: Options) {
    const current = useRef(options);
    useLayoutEffect(() => { current.current = options; });
    const workRef = useRef(newWork());
    const [revision, refresh] = useReducer(n => n + 1, 0);
    const [seconds, setSeconds] = useState<number | null>(null);
    const [waitingReason, setWaitingReason] = useState<string | null>(null);
    const [visible, setVisible] = useState(() => !document.hidden);

    const cancel = useCallback(() => {
        const work = workRef.current;
        work.pending = false;
        work.nudgeScore = 0;
        work.firstUnansweredAt = 0;
        work.cancelVersion++;
        setSeconds(null);
        setWaitingReason(null);
        refresh();
    }, []);

    useLayoutEffect(() => {
        workRef.current = newWork();
        setSeconds(null);
        setWaitingReason(null);
        refresh();
        return () => { workRef.current = newWork(); };
    }, [options.conversationId, options.enabled, options.active]);

    // 手动闪电、重生成或其他生成入口已经接手时，取消尚未执行的自动回复。
    useLayoutEffect(() => {
        if (options.generating) cancel();
    }, [options.generating, cancel]);

    useEffect(() => {
        const onVisibility = () => setVisible(!document.hidden);
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    // 从发送开始就暂停计时，直到图片处理、落库和聊天刷新都结束。
    // 返回的完成函数绑定本次会话；切走或取消后，晚到的结果不会重新启动倒计时。
    const beginSend = useCallback((conversationId: string | null, options?: { nudge?: boolean }) => {
        if (!current.current.enabled || !current.current.active || conversationId !== current.current.conversationId) {
            return (_sent: boolean) => {};
        }
        const work = workRef.current;
        const token = Symbol();
        const version = work.cancelVersion;
        work.sends.add(token);
        setSeconds(null);
        refresh();
        return (sent: boolean) => {
            if (workRef.current !== work || !work.sends.delete(token)) return;
            if (sent && version === work.cancelVersion) {
                if (!work.pending) work.firstUnansweredAt = Date.now();
                work.pending = true;
                // An actual "戳一戳" is an explicit nudge, worth two ordinary
                // user messages; failed sends never count. All still share one turn.
                work.nudgeScore += options?.nudge ? 2 : 1;
            }
            refresh();
        };
    }, []);

    useEffect(() => {
        const work = workRef.current;
        const ready = () => {
            const latest = current.current;
            return workRef.current === work && work.pending && work.sends.size === 0
                && latest.enabled && latest.active && !latest.blocked && !latest.generating
                && !document.hidden;
        };
        if (!visible || !ready()) {
            setSeconds(null);
            setWaitingReason(null);
            return;
        }
        // Normal automatic reply checkbox remains the old two-second behavior.
        // Only "真人感" uses the APK-style grounded busy / repeated-nudge gate.
        const latest = current.current;
        const plan = latest.naturalPacing
            ? resolveRealPersonReplyPlan({
                activity: latest.lifeActivity ?? null,
                nudgeScore: work.nudgeScore,
                firstUnansweredAt: work.firstUnansweredAt,
                now: Date.now(),
                fallbackDelayMs: getNaturalReplyDelay(latest.conversationId || ''),
            })
            : { delayMs: CHAT_AUTO_REPLY_DELAY_MS, waitingReason: null };
        setWaitingReason(plan.waitingReason);
        if (plan.delayMs === null) {
            setSeconds(null);
            // Keep the original successful-send anchor. Reconsider if today's
            // schedule changes or a subsequent message nudges us; do not burn
            // API calls just to ask if the character is free.
            const recheck = window.setTimeout(() => refresh(), 30_000);
            return () => window.clearTimeout(recheck);
        }
        const delay = plan.delayMs;
        setSeconds(Math.ceil(delay / 1000));
        const tick = window.setInterval(() => {
            if (ready()) setSeconds(value => value == null ? null : Math.max(1, value - 1));
        }, 1000);
        const timer = window.setTimeout(() => {
            if (!ready()) return;
            cancel();
            current.current.onGenerate();
        }, delay);
        return () => { window.clearInterval(tick); window.clearTimeout(timer); };
    }, [revision, visible, options.enabled, options.active, options.blocked, options.generating,
        options.conversationId, options.lifeActivity, options.naturalPacing, cancel]);

    return { seconds, waitingReason, beginSend, cancel };
}
