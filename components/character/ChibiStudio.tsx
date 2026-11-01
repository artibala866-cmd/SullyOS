import React, { useState } from 'react';
import { useOS } from '../../context/OSContext';
import HomeFigureStudio from './HomeFigureStudio';
import CreatorPartsUploader from './CreatorPartsUploader';
import TokenImg from '../os/TokenImg';
import { CaretLeft, CaretRight, FileArrowUp, PencilSimple, Sparkle } from '@phosphor-icons/react';

// 手办柜唯一数据源：3D 家园的 chibiStudio.home3D。
// 已移除的独立展台不再读取、展示或保存；用户已有的 3D 家园造型不会被覆盖。
const cabinetBg = 'linear-gradient(180deg, #241b3f 0%, #171130 55%, #120d24 100%)';
const caseBg = 'linear-gradient(180deg, rgba(58,48,96,0.85), rgba(28,22,52,0.95))';

export const ChibiShelfPanel: React.FC<{ charId: string; onOpen: () => void }> = ({ charId, onOpen }) => {
    const { characters } = useOS();
    const char = characters.find(c => c.id === charId);
    if (!char) return null;
    const figure = char.chibiStudio?.home3D;
    return <div className="animate-fade-in space-y-4">
        <button type="button" onClick={onOpen} aria-label="进入 3D 家园手办柜"
            className="block w-full text-left rounded-3xl overflow-hidden border border-white/10 shadow-[0_10px_30px_rgba(40,30,80,0.35)] active:scale-[0.99] transition-transform"
            style={{ background: cabinetBg }}>
            <div className="flex items-baseline gap-2 px-4 pt-4 pb-2">
                <strong className="font-serif text-[15px] text-white tracking-wide">QQ捏人 · 手办柜</strong>
                <span className="text-[9px] tracking-[3px] text-indigo-300/60">3D HOME</span>
                <span className="ml-auto text-[10px] text-indigo-200/60">{figure?.state ? '1' : '0'}/1 已上架</span>
            </div>
            <div className="px-4 pb-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] text-center py-4">
                    <div className="h-32 flex items-center justify-center">
                        {figure?.img ? <TokenImg value={figure.img} alt="3D 家园 Q 版形象" className="h-28 max-w-[75%] object-contain" /> : <Sparkle size={45} className="text-indigo-200/40" />}
                    </div>
                    <div className="font-semibold text-indigo-100 text-sm">3D 家园 · Q 版形象</div>
                    <div className="text-[11px] text-indigo-200/55 mt-1">{figure?.state ? '已保存 · 点击编辑' : '尚未捏人 · 点击创建'}</div>
                </div>
            </div>
        </button>
        <button type="button" onClick={onOpen} className="w-full rounded-2xl py-3 text-[13px] font-bold text-white shadow-[0_6px_18px_rgba(140,120,200,0.30)] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #a78bda, #8f9bf4)' }}>🧸 进入手办柜</button>
        <p className="text-[10.5px] text-slate-400 px-1">这里只展示与 3D 家园共用的 Q 版手办。</p>
    </div>;
};

const ChibiStudio: React.FC<{ charId: string; onClose: () => void }> = ({ charId, onClose }) => {
    const { characters } = useOS();
    const char = characters.find(c => c.id === charId);
    const [editing, setEditing] = useState(false);
    const [showUploader, setShowUploader] = useState(false);
    if (!char) return null;
    if (editing) return <HomeFigureStudio charId={charId} startEditing onClose={() => setEditing(false)} />;
    if (showUploader) return <CreatorPartsUploader onClose={() => setShowUploader(false)} />;
    const figure = char.chibiStudio?.home3D;
    return <div className="fixed inset-0 z-[60] flex flex-col text-white" style={{ background: cabinetBg }}>
        <div className="shrink-0 px-5 pb-3" style={{ paddingTop: 'var(--chrome-top)' }}>
            <div className="flex items-center gap-2 pt-2">
                <button onClick={onClose} aria-label="返回" className="p-2 -ml-2 rounded-full text-indigo-100 active:bg-white/10"><CaretLeft size={20} weight="bold" /></button>
                <div className="flex-1">
                    <h2 className="font-serif text-lg font-bold tracking-wide">QQ捏人 · 手办柜</h2>
                    <p className="text-[10px] tracking-[3px] text-indigo-300/60">3D HOME FIGURE</p>
                </div>
                <TokenImg value={char.avatar} alt={char.name} className="h-8 w-8 rounded-full object-cover border border-white/30" />
            </div>
            <p className="text-[11px] text-indigo-200/65 mt-2">仅保留 3D 家园 Q 版手办，编辑后直接应用于家园。</p>
            <button onClick={() => setShowUploader(true)} className="mt-3 w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5 border border-amber-300/25 active:scale-[0.99]"
                style={{ background: 'linear-gradient(135deg, rgba(251,191,36,0.14), rgba(245,158,11,0.06))' }}>
                <FileArrowUp size={16} weight="bold" className="text-amber-300 shrink-0" />
                <span className="text-[12px] font-bold text-amber-100">上传自定义素材（PSD 批量导入）</span>
                <CaretRight size={15} weight="bold" className="ml-auto text-amber-200/50" />
            </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pt-4" style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.45)]" style={{ background: caseBg }}>
                <div className="relative flex h-52 items-end justify-center pb-5">
                    {figure?.img ? <TokenImg value={figure.img} alt="3D 家园 Q 版形象" className="relative z-10 max-w-[70%] h-40 object-contain" /> : <Sparkle size={55} className="relative z-10 text-indigo-200/40 mb-10" />}
                    <div className="absolute bottom-3 w-28 h-5 rounded-[50%]" style={{ background: 'linear-gradient(180deg, #a78bda55, rgba(255,255,255,0.08))' }} />
                </div>
                <div className="px-4 pb-4">
                    <div className="flex items-baseline gap-2">
                        <strong className="font-serif text-[15px]">3D 家园 · Q 版形象</strong>
                        <span className="ml-auto text-[10px] text-indigo-200/60">{figure?.state ? '已保存' : '未创建'}</span>
                    </div>
                    <p className="text-[11px] text-indigo-200/60 mt-1 mb-3">修改五官、衣服与体型，保存后与 3D 家园共用。</p>
                    <button type="button" onClick={() => setEditing(true)} className="w-full rounded-xl py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
                        style={{ background: 'linear-gradient(135deg, #a78bda, #8f9bf4)' }}>
                        <PencilSimple size={16} />{figure?.state ? '编辑家园手办' : '捏一个家园手办'}
                    </button>
                </div>
            </div>
        </div>
    </div>;
};
export default ChibiStudio;
