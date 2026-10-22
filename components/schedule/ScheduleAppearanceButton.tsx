import {requestBeautyLibrary} from '../../utils/beautyNavigation';
import {AppID} from '../../types';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    ArrowCounterClockwise,
    Check,
    Copy,
    GearSix,
    X,
} from '@phosphor-icons/react';
import type { ScheduleCardAppearance } from '../../types';
import { useOS } from '../../context/OSContext';
import {
    SCHEDULE_CSS_SCOPE_HINT,
    SCHEDULE_CSS_SCOPE_REGEX,
    resolveScheduleCardPalette,
} from '../../utils/scheduleAppearance';
import {
    runCssRenderabilityCheck,
    validateScopedCss,
} from '../../utils/scopedCss';

const AI_PROMPT = `你是 CSS 设计师，请为 SullyOS·糯米机 的日程卡片写一段自定义 CSS。
只能使用以 .sully-schedule-* 开头的选择器；覆盖内联样式时使用 !important。

可用钩子：
- .sully-schedule-root：所有日程卡根节点
- .sully-schedule-card：完整日程卡
- .sully-schedule-widget：桌面日程卡
- .sully-schedule-header：卡片头部
- .sully-schedule-cover：角色看板图
- .sully-schedule-list：日程列表
- .sully-schedule-item：单条日程
- .sully-schedule-item-current：当前日程
- .sully-schedule-time：时间
- .sully-schedule-activity：活动标题
- .sully-schedule-description：活动描述
- .sully-schedule-timeline：底部时间线
- .sully-schedule-settings：右上角设置按钮

可以使用这些变量：
--schedule-bg、--schedule-text、--schedule-accent、--schedule-accent-soft、--schedule-base、--schedule-line。

请直接输出完整 CSS，不要写解释。我想要的风格是：______`;

function defaultDraft(current?: ScheduleCardAppearance): ScheduleCardAppearance {
    return {
        preset: 'custom',
        background: current?.background || '#e6e7e9',
        textColor: current?.textColor || '#303238',
        accentColor: current?.accentColor || '#62656a',
        customCss: current?.customCss || '',
    };
}

export const ScheduleCustomCssStyle: React.FC = () => {
    const { theme } = useOS();
    const css = theme.scheduleCardAppearance?.customCss || '';
    const validation = useMemo(
        () => validateScopedCss(css, SCHEDULE_CSS_SCOPE_REGEX, SCHEDULE_CSS_SCOPE_HINT),
        [css],
    );
    if (!css.trim() || !validation.isValid) return null;
    return <style>{css}</style>;
};

const ScheduleAppearanceButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const { theme, updateTheme, addToast,openApp } = useOS();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<ScheduleCardAppearance>(() =>
        defaultDraft(theme.scheduleCardAppearance)
    );
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDraft(defaultDraft(theme.scheduleCardAppearance));
    }, [open, theme.scheduleCardAppearance]);

    useEffect(() => {
        if (!open) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [open]);

    const validation = useMemo(
        () => validateScopedCss(
            draft.customCss || '',
            SCHEDULE_CSS_SCOPE_REGEX,
            SCHEDULE_CSS_SCOPE_HINT,
        ),
        [draft.customCss],
    );
    const preview = resolveScheduleCardPalette(draft, theme.hue, theme.contentColor || '#ffffff');

    const stop: React.MouseEventHandler = event => {
        event.preventDefault();
        event.stopPropagation();
    };

    const save = async () => {
        const renderability = runCssRenderabilityCheck(draft.customCss || '', validation);
        if (!renderability.ok) {
            addToast(renderability.message, 'error');
            return;
        }
        await updateTheme({ scheduleCardAppearance: { ...draft } });
        addToast('日程卡片样式已同步', 'success');
        setOpen(false);
    };

    const reset = async () => {
        await updateTheme({ scheduleCardAppearance: undefined });
        addToast('已还原原版日程卡片', 'success');
        setOpen(false);
    };

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(AI_PROMPT);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            addToast('复制失败，请手动选择文本', 'error');
        }
    };

    const panel = open ? createPortal(
        <div
            className="fixed inset-0 z-[1900] flex items-end justify-center bg-black/45 backdrop-blur-sm"
            onMouseDown={event => {
                if (event.target === event.currentTarget) setOpen(false);
            }}
            onClick={event => event.stopPropagation()}
        >
            <div
                className="w-full max-w-[620px] max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-[#fbfafc] text-slate-800 shadow-2xl"
                style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
                onMouseDown={event => event.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[#fbfafc]/95 backdrop-blur border-b border-slate-200/70">
                    <div>
                        <div className="text-[10px] font-bold tracking-[.2em] uppercase text-slate-400">Schedule skin</div>
                        <h2 className="text-base font-black mt-0.5">日程卡片美化</h2><button className="text-xs text-slate-600 mt-2" onClick={()=>{setOpen(false);requestBeautyLibrary('schedule');openApp(AppID.Appearance);}}>到外观 App 收藏与分享 ›</button>
                    </div>
                    <button
                        className="w-9 h-9 rounded-full grid place-items-center bg-slate-100 text-slate-500"
                        onClick={() => setOpen(false)}
                        aria-label="关闭日程卡片设置"
                    >
                        <X size={17} />
                    </button>
                </div>

                <div className="p-5 space-y-7">
                    <section>
                        <div className="mb-3">
                            <h3 className="text-sm font-bold">配色</h3>
                            <p className="text-[11px] text-slate-400 mt-1">桌面、房间和聊天里的日程卡会一起变化。</p>
                        </div>
                        <div className="rounded-2xl border border-[#d8dadd] bg-gradient-to-br from-white to-[#e8e9eb] p-4 text-[#383a3e]">
                            <div className="text-sm font-semibold">灰白磨砂 · 默认</div>
                            <p className="text-[11px] text-[#8b8e93] mt-1">统一低饱和样式，不提供彩色预设。</p>
                        </div>
                        <button className="mt-3 w-full rounded-xl border border-[#d8dadd] bg-white/80 px-4 py-3 text-left text-xs font-semibold text-[#4c4f54]"
                            onClick={() => setDraft(current => ({ ...current, preset: 'custom' }))}>自定义通道 · 配色与 CSS</button>
                    </section>

                    {(
                        <section className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div
                                className="h-20 rounded-xl mb-4 p-3 flex flex-col justify-between"
                                style={{ background: preview.background, color: preview.text }}
                            >
                                <span className="text-[9px] uppercase tracking-[.2em] opacity-55">Daily schedule</span>
                                <b style={{ color: preview.accent }}>08:30 · 今天的日程</b>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {([
                                    ['background', '背景', draft.background || '#e6e7e9'],
                                    ['textColor', '文字', draft.textColor || '#303238'],
                                    ['accentColor', '强调', draft.accentColor || '#62656a'],
                                ] as const).map(([key, label, value]) => (
                                    <label key={key} className="text-[11px] text-slate-500">
                                        <span className="block mb-1.5">{label}</span>
                                        <span className="flex items-center gap-2 rounded-xl border border-slate-200 p-2">
                                            <input
                                                type="color"
                                                value={value}
                                                onChange={event => setDraft(current => ({
                                                    ...current,
                                                    [key]: event.target.value,
                                                }))}
                                                className="w-7 h-7 rounded border-0 bg-transparent p-0"
                                            />
                                            <span className="font-mono text-[9px]">{value}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </section>
                    )}

                    <section>
                        <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <h3 className="text-sm font-bold">自定义 CSS</h3>
                                <p className="text-[11px] text-slate-400 mt-1">类似白框美化，只作用于日程卡。</p>
                            </div>
                            <button
                                onClick={copyPrompt}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 text-slate-600 text-[11px] font-bold"
                            >
                                {copied ? <Check size={13} /> : <Copy size={13} />}
                                {copied ? '已复制' : '复制 AI 提示词'}
                            </button>
                        </div>
                        <textarea
                            value={draft.customCss || ''}
                            onChange={event => setDraft(current => ({ ...current, customCss: event.target.value }))}
                            rows={11}
                            spellCheck={false}
                            className="w-full resize-y rounded-2xl border border-slate-200 bg-[#17141d] p-4 font-mono text-[11px] leading-5 text-slate-100 outline-none focus:border-slate-400"
                            placeholder=".sully-schedule-root {&#10;  border-radius: 20px !important;&#10;}"
                        />
                        {!validation.isValid && (
                            <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-600">
                                {validation.errors[0]}
                            </div>
                        )}
                        <details className="mt-3 text-[11px] text-slate-500">
                            <summary className="cursor-pointer font-bold">查看可用 CSS 钩子</summary>
                            <p className="mt-2 leading-5">
                                root、card、widget、header、cover、list、item、item-current、time、
                                activity、description、timeline、settings，均以 <code>.sully-schedule-</code> 开头。
                                内联颜色需要用 <code>!important</code> 覆盖。
                            </p>
                        </details>
                    </section>
                </div>

                <div className="sticky bottom-0 flex gap-2 px-5 pt-3 pb-1 bg-[#fbfafc]/95 backdrop-blur border-t border-slate-200/70">
                    <button
                        className="h-12 px-4 rounded-2xl bg-slate-100 text-slate-500 font-bold text-xs flex items-center gap-2"
                        onClick={reset}
                    >
                        <ArrowCounterClockwise size={15} />
                        还原
                    </button>
                    <button
                        className="h-12 flex-1 rounded-2xl bg-slate-900 text-white font-bold text-sm disabled:opacity-40"
                        disabled={!validation.isValid}
                        onClick={save}
                    >
                        保存并同步
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <>
            <button
                type="button"
                className={`sully-schedule-settings grid place-items-center rounded-full border transition-all active:scale-90 ${
                    compact ? 'w-7 h-7' : 'w-8 h-8'
                }`}
                style={{
                    color: 'var(--schedule-text)',
                    background: 'color-mix(in srgb, var(--schedule-text) 10%, transparent)',
                    borderColor: 'var(--schedule-line)',
                }}
                onPointerDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={event => {
                    stop(event);
                    setOpen(true);
                }}
                aria-label="日程卡片设置"
                title="日程卡片设置"
            >
                <GearSix size={compact ? 13 : 15} weight="bold" />
            </button>
            {panel}
        </>
    );
};

export default ScheduleAppearanceButton;
