import React, { useEffect, useState } from 'react';
import { ChatCircleDots, Brain } from '@phosphor-icons/react';
import { CHAT_GEN_EVENTS, CHAT_VIEW_CHANGED_EVENT, getChatViewSnapshot } from '../utils/chatGenEvents';
import { AMSG_INSTANT_CHAT_PENDING_EVENT, listInstantChatPendings } from '../utils/amsgInstantChat';
import { INSTANT_TOTAL_TIMEOUT_MS } from '../worker/amsg/src/instantChat';

/**
 * 聊天生成全局横幅（对标彼方的 VRBroadcast，App 根级挂载）。
 *
 * 监听 useChatAI / evaluateEmotionBackground 派发的 chat-gen-* 事件，显示
 * 「xx 正在回应…」「xx 正在感受…」。生成闭包在 Chat 卸载后继续跑，事件照发，
 * 所以用户切走 Chat 也能看到生成还活着；点横幅跳回该角色的聊天页
 * （复用 OSContext 已有的 'active-msg-open' 监听）。
 *
 * 抑制规则：用户正开着该角色的聊天页时不显示（页内已有打字/情绪指示灯），
 * 切走的瞬间由 CHAT_VIEW_CHANGED_EVENT 触发重渲染、横幅接棒。
 *
 * 结束信号都在 finally 里派发，正常不会漏；TTL 只是兜底（上云那两条路的
 * emotionDone 可能因 worker 被杀/推送丢失而永不到达）。
 */

type GenKind = 'reply' | 'emotion';
interface GenEntry { kind: GenKind; charId: string; charName: string; startedAt: number; ttlMs: number; }

// 兜底过期的默认档：主回复对齐 instant 300s 超时 + 本地重试余量；情绪评估按本地评估的量级给。
//
// 派发方可以用 detail.ttlMs 单条覆盖，上云的情绪评估就是这么干的：同一个「正在感受」
// 在本地是几秒钟的事，交给自己那台 worker 的即时对话却能跑满十分钟。这里要是一律按
// 默认档扫掉，横幅会在角色还在云端想着的时候先自己消失，用户以为没在跑了。
// 覆盖值与 Chat 页那盏徽章用的是同一个数（见 useChatAI 的 cloudEvalTimeoutMs），
// 两处必须一起改——不然横幅和徽章会一前一后灭，看着像出了两次故障。
const TTL_MS: Record<GenKind, number> = { reply: 6 * 60_000, emotion: 2 * 60_000 };

const LABEL: Record<GenKind, string> = { reply: '正在回应', emotion: '正在感受' };

// 即时对话待收条目的兜底 TTL：worker fire 上限 + 一分钟推送在途（与 useChatAI 的
// cloudEvalTimeoutMs 同一来源推导，worker 调预算两边一起动）。正常熄灭不靠它——
// 待收记录销账（回复到了 / 判失败）那一刻事件就把条目撤了。
const INSTANT_PENDING_TTL_MS = INSTANT_TOTAL_TIMEOUT_MS + 60_000;

const ChatBroadcast: React.FC = () => {
    const [entries, setEntries] = useState<GenEntry[]>([]);
    const [, setViewTick] = useState(0);
    // 即时对话的「正在回应」不靠 replyStart/replyEnd 撑：instant 分支 POST 完就 return，
    // finally 的 replyEnd 几秒内就把事件条目撤了，而云端还要跑最长十分钟。这里直接以
    // 待收记录为准（localStorage 持久，重启后横幅也还在）——受理点亮、销账熄灭。
    const [, setPendingTick] = useState(0);

    useEffect(() => {
        const add = (kind: GenKind) => (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string; charName?: string; ttlMs?: number };
            if (!d?.charId) return;
            const ttlMs = typeof d.ttlMs === 'number' && d.ttlMs > 0 ? d.ttlMs : TTL_MS[kind];
            setEntries(prev => prev.some(x => x.kind === kind && x.charId === d.charId)
                ? prev
                : [...prev, { kind, charId: d.charId!, charName: d.charName || '', startedAt: Date.now(), ttlMs }]);
        };
        const remove = (kind: GenKind) => (e: Event) => {
            const id = (e as CustomEvent).detail?.charId;
            if (!id) return;
            setEntries(prev => {
                const next = prev.filter(x => !(x.kind === kind && x.charId === id));
                return next.length === prev.length ? prev : next;
            });
        };
        const onReplyStart = add('reply');
        const onReplyEnd = remove('reply');
        const onEmotionStart = add('emotion');
        const onEmotionEnd = remove('emotion');
        const onView = () => setViewTick(n => n + 1);
        window.addEventListener(CHAT_GEN_EVENTS.replyStart, onReplyStart);
        window.addEventListener(CHAT_GEN_EVENTS.replyEnd, onReplyEnd);
        window.addEventListener(CHAT_GEN_EVENTS.emotionStart, onEmotionStart);
        window.addEventListener(CHAT_GEN_EVENTS.emotionEnd, onEmotionEnd);
        // 上云的情绪评估在 worker 跑，结束信号由 activeMsgRuntime / 收尾判定派发
        window.addEventListener(CHAT_GEN_EVENTS.emotionDone, onEmotionEnd);
        window.addEventListener(CHAT_VIEW_CHANGED_EVENT, onView);
        const onPending = () => setPendingTick(n => n + 1);
        window.addEventListener(AMSG_INSTANT_CHAT_PENDING_EVENT, onPending);
        const sweeper = setInterval(() => {
            const now = Date.now();
            setEntries(prev => {
                const next = prev.filter(x => now - x.startedAt < x.ttlMs);
                return next.length === prev.length ? prev : next;
            });
            // 待收条目的 TTL 过期只在渲染时判，欠着回复时靠这个 tick 保证有下一次渲染。
            if (listInstantChatPendings().length > 0) setPendingTick(n => n + 1);
        }, 15_000);
        return () => {
            window.removeEventListener(AMSG_INSTANT_CHAT_PENDING_EVENT, onPending);
            window.removeEventListener(CHAT_GEN_EVENTS.replyStart, onReplyStart);
            window.removeEventListener(CHAT_GEN_EVENTS.replyEnd, onReplyEnd);
            window.removeEventListener(CHAT_GEN_EVENTS.emotionStart, onEmotionStart);
            window.removeEventListener(CHAT_GEN_EVENTS.emotionEnd, onEmotionEnd);
            window.removeEventListener(CHAT_GEN_EVENTS.emotionDone, onEmotionEnd);
            window.removeEventListener(CHAT_VIEW_CHANGED_EVENT, onView);
            clearInterval(sweeper);
        };
    }, []);

    // 即时对话待收 → 「正在回应」条目（同角色已有事件驱动的 reply 条目时不重复）。
    const now = Date.now();
    const cloudEntries: GenEntry[] = listInstantChatPendings()
        .filter(p => now - p.acceptedAt < INSTANT_PENDING_TTL_MS)
        .filter(p => !entries.some(e => e.kind === 'reply' && e.charId === p.charId))
        .map(p => ({
            kind: 'reply' as const, charId: p.charId, charName: p.charName || '',
            startedAt: p.acceptedAt, ttlMs: INSTANT_PENDING_TTL_MS,
        }));

    const view = getChatViewSnapshot();
    const visible = [...entries, ...cloudEntries].filter(x => !(view.chatOpen && view.charId === x.charId));
    if (visible.length === 0) return null;
    // 回复优先于情绪展示（同角色两个都在跑时"正在回应"信息量更大）
    const cur = [...visible].sort((a, b) =>
        (a.kind === b.kind ? a.startedAt - b.startedAt : (a.kind === 'reply' ? 1 : -1))
    )[visible.length - 1];
    const concurrentEmotion = cur.kind === 'reply' && visible.some(e => e.charId === cur.charId && e.kind === 'emotion');
    const count = visible.length - (concurrentEmotion ? 1 : 0);
    const extra = count > 1 ? ` 等 ${count} 项` : '';
    const statusLabel = concurrentEmotion ? '正在回应 · 情绪评估中' : LABEL[cur.kind];

    const jump = () => {
        try {
            window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId: cur.charId } }));
        } catch { /* ignore */ }
    };

    return (
        <div className="fixed left-1/2 -translate-x-1/2 z-[999]"
            style={{ top: 'calc(var(--safe-top) + 44px)' }}>
            <style>{`@keyframes chatbcin{from{opacity:0;transform:translateY(-9px)}to{opacity:1;transform:translateY(0)}}
                     @keyframes chatbcdot{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:.9;transform:translateY(-2px)}}
                     @media (prefers-reduced-motion: reduce){.chat-broadcast-pill,.chat-broadcast-dot{animation:none!important}}`}</style>
            <button type="button" onClick={jump} aria-label={`${cur.charName}${extra} ${statusLabel}，点击返回聊天`}
                className="chat-broadcast-pill relative flex items-center gap-2.5 rounded-full border px-3.5 py-2 cursor-pointer active:scale-[.98] transition-transform"
                style={{
                    animation: 'chatbcin .28s ease-out',
                    // Instagram-like monochrome: a single neutral gray surface, no green glow or gradients.
                    background: 'rgba(242, 242, 242, .97)',
                    borderColor: 'rgba(130, 130, 130, .32)',
                    color: '#333333',
                    boxShadow: '0 3px 12px rgba(0, 0, 0, .10)',
                }}>
                <span className="flex shrink-0 items-center justify-center text-[#414141]" aria-hidden="true">
                    {cur.kind === 'reply' ? <ChatCircleDots size={16} weight="regular" /> : <Brain size={16} weight="regular" />}
                </span>
                <span className="text-[12px] leading-4 tracking-normal text-[#555555] whitespace-nowrap font-normal">
                    <span className="text-[#303030] font-medium">{cur.charName}</span>{extra} {statusLabel}
                </span>
                <span className="flex items-center gap-1" aria-hidden="true">
                    {[0, 1, 2].map(i => (
                        <span key={i} className="chat-broadcast-dot h-1 w-1 rounded-full bg-[#898989]"
                            style={{ animation: 'chatbcdot 1.2s infinite', animationDelay: `${i * 0.2}s` }} />
                    ))}
                </span>
            </button>
        </div>
    );
};

export default ChatBroadcast;
