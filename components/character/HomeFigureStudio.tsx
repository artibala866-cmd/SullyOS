import {createLocalId} from '../../utils/localId.js';
import {homelyPaletteStyle} from '../os/homelyPalette';
import './homeFigureEditor.css';
import React, {useState} from 'react';
import {useOS} from '../../context/OSContext';
const HomeFigureEditor = React.lazy(() => import('./HomeFigureEditor'));
import {UserCircle} from '@phosphor-icons/react';
import TokenImg from '../os/TokenImg';
import type {HomeFigureSlot} from '../../types';

export default function HomeFigureStudio({charId, onClose, startEditing = false}: {charId?: string; onClose: () => void; startEditing?: boolean}) {
    const {theme, characters, userProfile, updateCharacter, updateUserProfile} = useOS();
    const char = characters.find(c => c.id === charId);
    const [editing, setEditing] = useState<'source' | 'home' | null>(startEditing ? 'source' : null);
    const [source, setSource] = useState<{value?: HomeFigureSlot; draftKey?: string}>({});
    if (charId && !char) return null;
    const owner = char ?? userProfile, name = owner.name || '你';
    const figure = owner.chibiStudio?.home3D;
    const chooseSource = (value?: HomeFigureSlot) => {
        setSource({value, draftKey: `home_figure_${charId ?? 'user'}_${createLocalId()}`});
        setEditing('home');
    };
    const saveHome = (value: HomeFigureSlot) => {
        if (char) updateCharacter(char.id, prev => ({chibiStudio: {...prev.chibiStudio, home3D: value}}));
        else updateUserProfile(prev => ({chibiStudio: {...prev.chibiStudio, home3D: value}}));
        if(startEditing)onClose();else setEditing(null);
    };
    if (editing === 'source') return <div className="home-figure-studio fixed inset-0 z-[80] flex flex-col bg-[#f4f5ef] text-[#26372c]" style={{...homelyPaletteStyle(theme?.homelyPalette), paddingTop: 'var(--chrome-top)', paddingBottom: 'var(--safe-bottom)'}}>
        <header className="flex items-center gap-4 p-4"><button className="min-h-[44px]" onClick={startEditing ? onClose : () => setEditing(null)}>返回</button><h2 className="font-semibold">3D 家园 · Q 版捏人</h2></header>
        <div className="flex-1 overflow-auto px-5 pb-6 max-w-xl w-full mx-auto" style={{scrollbarWidth: 'thin'}}>
            {figure?.state && <button className="w-full min-h-[48px] rounded-xl bg-[#466a48] text-white mb-4" onClick={() => chooseSource(figure)}>继续编辑当前家园形象</button>}
            <button className="mt-4 w-full min-h-[48px] rounded-xl border border-[#a5b99a]" onClick={() => chooseSource()}>从头捏一个</button>
            <p className="mt-3 text-xs text-[#627062]">保存后直接使用在 3D 家园，不创建独立展台。</p>
        </div>
    </div>;
    if (editing === 'home') return <React.Suspense fallback={<div className="fixed inset-0 z-[80] bg-[#f4f5ef] p-8" style={{paddingTop: 'calc(var(--chrome-top) + 32px)'}}>正在打开 3D 捏人器…<button className="block mt-5" onClick={() => setEditing(null)}>返回</button></div>}><HomeFigureEditor paletteId={theme?.homelyPalette} name={name} ownerId={charId ?? 'user'} value={source.value} draftKey={source.draftKey} onSave={saveHome} onClose={() => setEditing('source')} /></React.Suspense>;
    return <div className="home-figure-studio fixed inset-0 z-[75] flex flex-col bg-[#f4f5ef] text-[#26372c]" style={{...homelyPaletteStyle(theme?.homelyPalette), paddingTop: 'var(--chrome-top)', paddingBottom: 'var(--safe-bottom)'}}>
        <header className="flex items-center gap-4 p-4"><button className="min-h-[44px]" onClick={onClose}>返回</button><h2 className="text-lg font-semibold">{name}的 3D 家园手办柜</h2></header>
        <div className="flex-1 overflow-auto px-5 pb-8 max-w-xl w-full mx-auto">
            <div className="grid grid-cols-1 gap-4">
                <button className="rounded-2xl bg-white border border-[#d7dfd1] p-4 flex flex-col items-center gap-3" onClick={() => setEditing('source')} aria-label={figure?.state?'编辑 3D 形象':'开始捏 3D 形象'}>
                    {figure?.img?<TokenImg value={figure.img} className="w-full h-44 object-contain"/>:<UserCircle size={104} weight="duotone" className="h-44 text-[#a5b99a]"/>}
                    <span className="font-semibold">家园形象</span><span className="text-xs text-[#627062]">{figure?.state?'点击换装':'＋ 捏一个 3D 形象'}</span>
                </button>
            </div>
            <p className="mt-4 text-xs text-[#627062]">这里只编辑与 3D 家园共用的一份 Q 版造型。</p>
        </div>
    </div>;
}


