import React, { useMemo, useState } from 'react';
import { useOS } from '../../context/OSContext';
import type { ChibiStudioSlotId } from '../../types';
import HomeFigureStudio from './HomeFigureStudio';
import { CreatorIframe, type ChibiResult, isSullyChar, sullyPresets } from './CreatorIframe';
import CreatorPartsUploader from './CreatorPartsUploader';
import { useBlobRefUrl, putImageBlob, dataUrlToBlob } from '../../utils/blobRef';
import TokenImg from '../os/TokenImg';
import { CaretLeft, CaretRight, PencilSimple, Sparkle, FileArrowUp } from '@phosphor-icons/react';

// ============================================================
// QQ捏人工坊（神经链接）—— 保留小小窝 Q 版手办、3D 家园与自定义素材。
// 旧节日活动已退役；不再展示、同步或写入旧活动槽位。
// ============================================================

// 安全区（与 index.html :root 单一来源对齐）：
//  · 全屏浮层顶栏统一用 --chrome-top（安全区 + SullyOS 状态栏；状态栏隐藏时自动塌回 --safe-top）。
//    不能只用 --safe-top，否则状态栏显示时顶栏会怼进时钟/电量条。
//  · 底部用 --safe-bottom（带 JS 探测兜底，iOS 全屏 PWA 原生 env(safe-area-inset-bottom)
//    偶发返回 0）+ 一点手势余量，别让控件贴着 home 条。
const STUDIO_TOP = 'var(--chrome-top)';
const STUDIO_BOTTOM = 'calc(2rem + var(--safe-bottom))';

interface SlotMeta {
    id: ChibiStudioSlotId;
    label: string;
    en: string;
    desc: string;
    /** 展台铭牌配色 */
    accent: string;
}

const SLOTS: SlotMeta[] = [
    { id: 'room', label: '小小窝', en: 'ROOM', desc: '站在房间里的立绘', accent: '#f4a3ca' },
];

const StudioStyle: React.FC = () => (
    <style>{`
        @keyframes chibistudio-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes chibistudio-shine { 0% { transform: translateX(-160%) skewX(-18deg); } 100% { transform: translateX(260%) skewX(-18deg); } }
        @keyframes chibistudio-twinkle { 0%,100% { opacity: .25; } 50% { opacity: .9; } }
    `}</style>
);

/** 展台背景星光（固定坐标，避免重渲染抖动） */
const CASE_SPARKLES: { top: string; left: string; s: number; d: string }[] = [
    { top: '12%', left: '10%', s: 8, d: '0s' }, { top: '20%', left: '84%', s: 6, d: '.8s' },
    { top: '58%', left: '6%', s: 5, d: '1.4s' }, { top: '40%', left: '90%', s: 7, d: '.4s' },
    { top: '74%', left: '80%', s: 5, d: '1.1s' },
];

interface SlotView {
    meta: SlotMeta;
    /** 原始存储值（room 可能是 blobref 令牌） */
    raw?: string;
    /** 可渲染 url（objectURL / data / http） */
    url?: string;
    /** 再编辑时还原用的完整捏人器 state */
    state?: any;
    updatedAt?: number;
}

const DisplayCase: React.FC<{
    view: SlotView;
    onEdit: () => void;
}> = ({ view, onEdit }) => {
    const { meta, url } = view;
    return (
        <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
            style={{ background: 'linear-gradient(180deg, rgba(58,48,96,0.85) 0%, rgba(28,22,52,0.95) 100%)' }}>
            {/* 顶部射灯 */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-36 pointer-events-none"
                style={{ background: `radial-gradient(60% 100% at 50% 0%, ${meta.accent}33 0%, transparent 70%)` }} />
            {/* 玻璃反光斜带 */}
            <div className="absolute inset-y-0 w-16 pointer-events-none opacity-[0.07]"
                style={{ background: 'linear-gradient(90deg, transparent, #fff, transparent)', animation: 'chibistudio-shine 5.5s ease-in-out infinite' }} />
            {CASE_SPARKLES.map((sp, i) => (
                <span key={i} className="absolute text-white pointer-events-none select-none"
                    style={{ top: sp.top, left: sp.left, fontSize: sp.s, animation: `chibistudio-twinkle 2.6s ease-in-out ${sp.d} infinite` }}>✦</span>
            ))}

            {/* 手办本体 */}
            <div className="relative h-44 flex items-end justify-center">
                {url ? (
                    <img src={url} alt={meta.label} className="relative z-10 object-contain mb-5 max-w-[70%]"
                        style={{ height: 128, animation: 'chibistudio-float 3.4s ease-in-out infinite', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.55))' }} />
                ) : (
                    <div className="relative z-10 mb-8 flex flex-col items-center gap-2 text-indigo-200/40">
                        <div className="w-20 h-24 rounded-xl border-2 border-dashed border-indigo-300/25 flex items-center justify-center">
                            <Sparkle size={22} />
                        </div>
                        <span className="text-[10px] tracking-widest">展台空着</span>
                    </div>
                )}
                {/* 底座：圆盘 + 投影 */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[104px] h-[22px] rounded-[50%]"
                    style={{ background: `linear-gradient(180deg, ${meta.accent}55, rgba(255,255,255,0.08))`, boxShadow: `0 2px 10px ${meta.accent}44 inset, 0 4px 14px rgba(0,0,0,.4)` }} />
                <div className="absolute bottom-[10px] left-1/2 -translate-x-1/2 w-24 h-3 rounded-[50%] bg-black/50 blur-[2px]" />
            </div>

            {/* 铭牌 + 操作 */}
            <div className="relative px-4 pb-3.5 pt-1">
                <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[15px] font-bold text-white tracking-wide">{meta.label}</span>
                    <span className="text-[9px] tracking-[3px] font-medium" style={{ color: meta.accent }}>{meta.en}</span>
                    <span className="ml-auto text-[10px] text-indigo-200/50">{view.updatedAt ? new Date(view.updatedAt).toLocaleDateString() : ''}</span>
                </div>
                <p className="text-[10.5px] text-indigo-200/55 mt-0.5 mb-2.5">{meta.desc}</p>
                <div className="flex gap-2">
                    <button onClick={onEdit}
                        className="flex-1 rounded-lg py-2 text-[11.5px] font-bold text-white flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                        style={{ background: `linear-gradient(135deg, ${meta.accent}cc, ${meta.accent}88)` }}>
                        <PencilSimple size={13} weight="bold" /> {url ? '重新捏' : '捏这只'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * 「手办」tab 的小小窝手办预览 + 进入手办柜按钮。
 * 只读展示，编辑/同步都在全屏工坊里做。
 */
export const ChibiShelfPanel: React.FC<{ charId: string; onOpen: () => void }> = ({ charId, onOpen }) => {
    const { characters } = useOS();
    const char = characters.find(c => c.id === charId);
    const roomUrl = useBlobRefUrl(char?.sprites?.chibi);
    if (!char) return null;
    const urlOf: Record<ChibiStudioSlotId, string | undefined> = { room: roomUrl };
    const dressed = roomUrl ? 1 : 0;

    return (
        <div className="animate-fade-in space-y-4">
            <StudioStyle />
            {/* 迷你展示柜（点整柜也能进） */}
            <div onClick={onOpen}
                className="relative rounded-3xl overflow-hidden border border-white/10 shadow-[0_10px_30px_rgba(40,30,80,0.35)] cursor-pointer active:scale-[0.99] transition-transform"
                style={{ background: 'linear-gradient(180deg, #2b2150 0%, #171130 100%)' }}>
                <div className="absolute inset-y-0 w-14 pointer-events-none opacity-[0.06]"
                    style={{ background: 'linear-gradient(90deg, transparent, #fff, transparent)', animation: 'chibistudio-shine 5.5s ease-in-out infinite' }} />
                {CASE_SPARKLES.map((sp, i) => (
                    <span key={i} className="absolute text-white pointer-events-none select-none"
                        style={{ top: sp.top, left: sp.left, fontSize: sp.s, animation: `chibistudio-twinkle 2.6s ease-in-out ${sp.d} infinite` }}>✦</span>
                ))}
                <div className="relative px-4 pt-4 pb-1 flex items-baseline gap-2">
                    <span className="font-serif text-[15px] font-bold text-white tracking-wide">QQ捏人 · 手办柜</span>
                    <span className="text-[9px] tracking-[3px] text-indigo-300/60 font-medium">FIGURE STUDIO</span>
                    <span className="ml-auto text-[10px] text-indigo-200/50">{dressed}/{SLOTS.length} 已上架</span>
                </div>
                {/* 迷你展台 */}
                <div className="relative grid grid-cols-1 gap-2 px-3 pb-4 pt-1">
                    {SLOTS.map(meta => {
                        const url = urlOf[meta.id];
                        return (
                            <div key={meta.id} className="relative rounded-xl overflow-hidden border border-white/10 bg-white/[0.03]">
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-16 pointer-events-none"
                                    style={{ background: `radial-gradient(60% 100% at 50% 0%, ${meta.accent}30 0%, transparent 70%)` }} />
                                <div className="relative h-[88px] flex items-end justify-center">
                                    {url ? (
                                        <img src={url} alt={meta.label} className="relative z-10 object-contain mb-2.5 max-w-[80%]"
                                            style={{ height: 62, animation: 'chibistudio-float 3.4s ease-in-out infinite', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.5))' }} />
                                    ) : (
                                        <div className="relative z-10 mb-5 w-9 h-11 rounded-lg border border-dashed border-indigo-300/25 flex items-center justify-center text-indigo-200/35">
                                            <Sparkle size={13} />
                                        </div>
                                    )}
                                    <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-12 h-[9px] rounded-[50%]"
                                        style={{ background: `linear-gradient(180deg, ${meta.accent}50, rgba(255,255,255,0.07))` }} />
                                </div>
                                <div className="relative text-center pb-1.5">
                                    <span className="text-[9.5px] font-bold text-indigo-100/85">{meta.label}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <button onClick={onOpen}
                className="w-full rounded-2xl py-3 text-[13px] font-bold text-white flex items-center justify-center gap-2 shadow-[0_6px_18px_rgba(140,120,200,0.30)] active:scale-[0.98] transition-transform"
                style={{ background: 'linear-gradient(135deg, #a78bda, #8f9bf4)' }}>
                🧸 进入手办柜
            </button>
            <p className="text-[10.5px] text-slate-400 leading-relaxed px-1">
                小小窝 Q 版形象在这里保存和编辑，3D 家园形象也能独立捏。
            </p>
        </div>
    );
};

const ChibiStudio: React.FC<{ charId: string; onClose: () => void }> = ({ charId, onClose }) => {
    const { characters, updateCharacter, addToast } = useOS();
    const char = characters.find(c => c.id === charId);

    const [editing, setEditing] = useState<ChibiStudioSlotId | null>(null);
    const [showUploader, setShowUploader] = useState(false); // 自定义素材工坊（PSD 批量导入）
    const [showHomeFigure, setShowHomeFigure] = useState(false);

    const studio = char?.chibiStudio;
    const roomUrl = useBlobRefUrl(char?.sprites?.chibi);
    const views: SlotView[] = useMemo(() => {
        if (!char) return [];
        return SLOTS.map(meta => ({
            meta,
            raw: char.sprites?.chibi,
            url: roomUrl,
            state: char.chibiStudio?.room?.state,
            updatedAt: char.chibiStudio?.room?.updatedAt,
        }));
    }, [char, roomUrl]);

    if (!char) return null;
    const isSully = isSullyChar(char);

    // 只保存小小窝图像与编辑状态，不改动历史活动记录和其他形象。
    const confirmSlot = async (slot: ChibiStudioSlotId, result: ChibiResult) => {
        try {
            const ref = await putImageBlob(dataUrlToBlob(result.transparentDataUrl));
            updateCharacter(char.id, prev => ({
                sprites: { ...(prev.sprites || {}), chibi: ref },
                chibiStudio: {
                    ...(prev.chibiStudio || {}),
                    room: { state: result.state, updatedAt: Date.now() },
                },
            }));
            addToast(`${SLOTS.find(item => item.id === slot)?.label}的手办已上架 ✓`, 'success');
            setEditing(null);
        } catch (e: any) {
            addToast(`保存失败：${e?.message || e}`, 'error');
        }
    };

    if (showHomeFigure) return <HomeFigureStudio charId={charId} onClose={() => setShowHomeFigure(false)} />;
    // ── 自定义素材工坊（PSD 批量导入）──
    if (showUploader) {
        return <CreatorPartsUploader onClose={() => setShowUploader(false)} />;
    }

    // ── 捏人器全屏页 ──
    if (editing) {
        const slotMeta = SLOTS.find(s => s.id === editing)!;
        const slotView = views.find(v => v.meta.id === editing);
        return (
            <div className="fixed inset-0 z-[70] flex flex-col bg-black">
                <div className="flex items-center gap-2 px-4 pb-2 shrink-0 text-white"
                    style={{ background: 'linear-gradient(180deg,#241b3f 0%,#120d24 100%)', paddingTop: STUDIO_TOP }}>
                    <button onClick={() => setEditing(null)} className="p-1.5 -ml-1.5 rounded-full active:bg-white/10"><CaretLeft size={20} weight="bold" /></button>
                    <span className="text-[14px] font-bold">捏 {char.name} 的{slotMeta.label}形象</span>
                </div>
                <div className="flex-1 min-h-0">
                    <CreatorIframe
                        mode="char"
                        charName={char.name}
                        isSully={isSully}
                        presets={isSully ? sullyPresets() : undefined}
                        savedState={slotView?.state}
                        draftKey={`studio_${char.id}_${editing}`}
                        title={`${char.name} · ${slotMeta.label}`}
                        subtitle={`FIGURE STUDIO · ${slotMeta.en}`}
                        onConfirm={r => { void confirmSlot(editing, r); }}
                    />
                </div>
            </div>
        );
    }

    // ── 展示柜主页 ──
    return (
        <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'linear-gradient(180deg, #241b3f 0%, #171130 55%, #120d24 100%)' }}>
            <StudioStyle />
            {/* 顶栏 */}
            <div className="shrink-0 px-5 pb-3" style={{ paddingTop: STUDIO_TOP }}>
                <div className="flex items-center gap-2 pt-2">
                    <button onClick={onClose} className="p-2 -ml-2 rounded-full text-indigo-100 active:bg-white/10"><CaretLeft size={20} weight="bold" /></button>
                    <div>
                        <h2 className="font-serif text-lg font-bold text-white tracking-wide leading-tight">QQ捏人 · 手办柜</h2>
                        <p className="text-[10px] tracking-[3px] text-indigo-300/60">FIGURE STUDIO</p>
                    </div>
                    <div className="ml-auto flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border border-white/15 bg-white/5">
                        <TokenImg value={char.avatar} alt={char.name} className="w-6 h-6 rounded-full object-cover border border-white/30" />
                        <span className="text-[11px] text-indigo-100 font-medium max-w-[80px] truncate">{char.name}</span>
                    </div>
                </div>
                <p className="text-[10.5px] text-indigo-300/55 mt-2 pl-1">
                    角色的 Q 版形象在此独立保存和编辑，3D 家园形象另行保存。
                </p>
                {/* 自定义素材工坊入口：PSD 批量导入自己的部件（正式站用户也能用） */}
                <button onClick={() => setShowUploader(true)}
                    className="mt-3 w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5 border border-amber-300/25 active:scale-[0.99] transition-transform"
                    style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.14), rgba(245,158,11,0.06))' }}>
                    <FileArrowUp size={16} weight="bold" className="text-amber-300 shrink-0" />
                    <span className="text-[12px] font-bold text-amber-100 tracking-wide">上传自定义素材（PSD 批量导入）</span>
                    <CaretRight size={15} weight="bold" className="ml-auto text-amber-200/50" />
                </button>
            </div>

            {/* 手办展示柜——底部给 home 条留白（iOS 全屏 PWA 用 --safe-bottom 兜底） */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 space-y-4"
                style={{ paddingBottom: STUDIO_BOTTOM }}>
                <button onClick={() => setShowHomeFigure(true)} className="w-full min-h-[64px] rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-left text-white">3D 家园形象 <span className="block text-xs opacity-60 mt-1">{studio?.home3D?.state ? '编辑形象、衣服与体型' : '基于已有手办，捏出家园里的你'}</span></button>
                {views.map(v => (
                    <DisplayCase key={v.meta.id} view={v}
                        onEdit={() => setEditing(v.meta.id)} />
                ))}
            </div>

        </div>
    );
};

export default ChibiStudio;
