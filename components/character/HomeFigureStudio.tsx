import {createLocalId} from '../../utils/localId.js';
import {homelyPaletteStyle} from '../os/homelyPalette';
import './homeFigureEditor.css';
import React, {useState, useRef} from 'react';
import {useOS} from '../../context/OSContext';
const HomeFigureEditor = React.lazy(() => import('./HomeFigureEditor'));
import {UserCircle} from '@phosphor-icons/react';
import TokenImg from '../os/TokenImg';
import type {HomeFigureSlot} from '../../types';
import {homeFigureSeed} from '../../utils/homeFigureSeed';
import {CreatorIframe, isSullyChar} from './CreatorIframe';
import {selectedHairAssets} from '../../apps/room3d/chibi/types';
import {defaultFace} from '../../apps/room3d/chibi/faceAppearance';
import {beginUserSaveOperation} from '../../utils/userSaves';

export default function HomeFigureStudio({charId, onClose, startEditing = false}: {charId?: string; onClose: () => void; startEditing?: boolean | 'chibi'}) {
    const {theme, characters, userProfile, updateCharacter, updateUserProfile, addToast} = useOS();
    const savingRef = useRef(false);
    const char = characters.find(c => c.id === charId);
    const [editing, setEditing] = useState<'source' | 'home' | 'chibi' | null>(startEditing === 'chibi' ? 'chibi' : startEditing ? 'source' : null);
    const [chibiDraftKey, setChibiDraftKey] = useState(() => `home_chibi_${charId ?? 'user'}_${createLocalId()}`);
    const [source, setSource] = useState<{value?: HomeFigureSlot; draftKey?: string}>({});
    if (charId && !char) return null;
    const owner = char ?? userProfile, name = owner.name || '你';
    const figure = owner.chibiStudio?.home3D;
    const chooseSource = (value?: HomeFigureSlot) => {
        setSource({value, draftKey: `home_figure_${charId ?? 'user'}_${createLocalId()}`});
        setEditing('home');
    };
    const closeEditor = () => {
        if (startEditing) onClose();
        else setEditing(null);
    };
    const openChibi = () => {
        setChibiDraftKey(`home_chibi_${charId ?? 'user'}_${createLocalId()}`);
        setEditing('chibi');
    };
    const saveFigure = async (update: (current?: HomeFigureSlot) => HomeFigureSlot) => {
        if (savingRef.current) return;
        savingRef.current = true;
        let release: (() => void) | undefined;
        try {
            release = beginUserSaveOperation('保存手办形象');
            if (char) updateCharacter(char.id, prev => ({chibiStudio: {...prev.chibiStudio, home3D: update(prev.chibiStudio?.home3D)}}));
            else await updateUserProfile(prev => ({chibiStudio: {...prev.chibiStudio, home3D: update(prev.chibiStudio?.home3D)}}));
            closeEditor();
        } catch (error) {
            addToast(error instanceof Error ? error.message : '手办保存失败，请重试', 'error');
        } finally { release?.(); savingRef.current = false; }
    };
    const studioStyle = {...homelyPaletteStyle(theme?.homelyPalette), paddingTop: 'var(--chrome-top)', paddingBottom: 'var(--safe-bottom)'};
    const isSully = !!char && isSullyChar(char);
    if (editing === 'chibi') return <div className="home-figure-studio fixed inset-0 z-[80] flex flex-col bg-[#f4f5ef] text-[#26372c]" style={studioStyle}>
        <header className="flex shrink-0 items-center gap-4 px-4">
            <button className="min-h-[44px]" onClick={closeEditor}>返回</button>
            <h2 className="font-semibold">{name} · 家园 Q 版捏脸</h2>
        </header>
        <div className="flex-1 min-h-0">
            <CreatorIframe mode={char ? 'char' : 'user'} charName={name} isSully={isSully}
                savedState={homeFigureSeed(figure?.state, isSully)} draftKey={chibiDraftKey}
                title={`${name} · 家园 Q 版形象`} subtitle="HOME FIGURE"
                onConfirm={result => {
                    if (!result.state?.selected || !result.transparentDataUrl) return;
                    saveFigure(current => ({
                        state: result.state,
                        img: result.transparentDataUrl,
                        hair: {
                            ...(current?.hair ?? {layers: {}, extras: [], bodyShape: 'blank',
                                face: {...defaultFace, useBaseEyes: true, useBaseMouth: true}}),
                            assets: selectedHairAssets(result.state),
                        },
                        updatedAt: Date.now(),
                    }));
                }} />
        </div>
    </div>;
    if (editing === 'source') return <div className="home-figure-studio fixed inset-0 z-[80] flex flex-col bg-[#f4f5ef] text-[#26372c]" style={studioStyle}>
        <header className="flex items-center gap-4 p-4"><button className="min-h-[44px]" onClick={startEditing ? onClose : () => setEditing(null)}>返回</button><h2 className="font-semibold">3D 家园 · 形象编辑</h2></header>
        <div className="flex-1 overflow-auto px-5 pb-6 max-w-xl w-full mx-auto" style={{scrollbarWidth: 'thin'}}>
            {figure?.state && <button className="w-full min-h-[48px] rounded-xl bg-[#466a48] text-white mb-4" onClick={() => chooseSource(figure)}>继续编辑当前家园形象</button>}
            <button className="mt-4 w-full min-h-[48px] rounded-xl border border-[#a5b99a]" onClick={() => chooseSource()}>从头捏一个</button>
            <button className="mt-4 w-full min-h-[48px] rounded-xl border border-[#a5b99a]" onClick={openChibi}>Q 版捏脸</button>
            <p className="mt-3 text-xs text-[#627062]">保存后直接使用在 3D 家园，不创建独立展台。</p>
        </div>
    </div>;
    if (editing === 'home') return <React.Suspense fallback={<div className="fixed inset-0 z-[80] bg-[#f4f5ef] p-8" style={{paddingTop: 'calc(var(--chrome-top) + 32px)'}}>正在打开 3D 捏人器…<button className="block mt-5" onClick={() => setEditing(null)}>返回</button></div>}><HomeFigureEditor paletteId={theme?.homelyPalette} name={name} ownerId={charId ?? 'user'} value={source.value} draftKey={source.draftKey} onSave={value => saveFigure(() => value)} onClose={() => setEditing('source')} /></React.Suspense>;
    return <div className="home-figure-studio fixed inset-0 z-[75] flex flex-col bg-[#f4f5ef] text-[#26372c]" style={studioStyle}>
        <header className="flex items-center gap-4 p-4"><button className="min-h-[44px]" onClick={onClose}>返回</button><h2 className="text-lg font-semibold">{name}的 3D 家园手办柜</h2></header>
        <div className="flex-1 overflow-auto px-5 pb-8 max-w-xl w-full mx-auto">
            <div className="grid grid-cols-1 gap-4">
                <button className="rounded-2xl bg-white border border-[#d7dfd1] p-4 flex flex-col items-center gap-3" onClick={() => setEditing('source')} aria-label={figure?.state?'编辑 3D 形象':'开始捏 3D 形象'}>
                    {figure?.img?<TokenImg value={figure.img} className="w-full h-44 object-contain"/>:<UserCircle size={104} weight="duotone" className="h-44 text-[#a5b99a]"/>}
                    <span className="font-semibold">家园形象</span><span className="text-xs text-[#627062]">{figure?.state?'编辑 3D 形象':'＋ 捏一个 3D 形象'}</span>
                </button>
            </div>
            <button className="mt-4 w-full min-h-[48px] rounded-xl border border-[#a5b99a]" onClick={openChibi}>Q 版捏脸</button>
            <p className="mt-4 text-xs text-[#627062]">这里只编辑与 3D 家园共用的一份 Q 版造型。</p>
        </div>
    </div>;
}


