import React, { useMemo, useState } from 'react';
import { CaretLeft, CaretRight, Check, SlidersHorizontal, X } from '@phosphor-icons/react';
import type { StoryTheaterPresetDocument } from '../../../types';
import { applyStoryPresetChoice, estimateStoryTokens, getStoryTavernAuthorSections, selectStoryTavernAuthorOption } from '../../../utils/storyTheater';
import { STORY_PRESET_SIMPLE_CHOICES } from './StoryPresetMaker';

interface Props {
    document: StoryTheaterPresetDocument;
    hasOverride: boolean;
    onApply: (document: StoryTheaterPresetDocument) => Promise<void> | void;
    onReset: () => Promise<void> | void;
    onClose: () => void;
}

const StoryQuickPresetPanel: React.FC<Props> = ({ document, hasOverride, onApply, onReset, onClose }) => {
    const [draft, setDraft] = useState<StoryTheaterPresetDocument>(() => ({ ...document, generation: { ...document.generation }, prompts: document.prompts.map(prompt => ({ ...prompt })) }));
    const [page, setPage] = useState(() => {
        // Opening the quick sheet from a live story should make author style
        // immediately reachable instead of forcing the user past permissions.
        if (document.sourceFormat !== 'sillytavern') return 0;
        const sections = getStoryTavernAuthorSections(document);
        const styleIndex = sections.findIndex(section => /文风|风格|style/i.test(section.label));
        return styleIndex >= 0 ? styleIndex : 0;
    });
    const [saving, setSaving] = useState(false);
    // Native presets keep their original simple controls. Tavern imports use
    // their OWN author groups and source prompt IDs, not the built-in IDs.
    const imported = draft.sourceFormat === 'sillytavern';
    const nativePages = useMemo(() => imported ? [] : STORY_PRESET_SIMPLE_CHOICES.filter(
        choice => choice.ids.some(id => draft.prompts.some(prompt => prompt.id === id))), [draft.prompts, imported]);
    const authorPages = useMemo(() => imported ? getStoryTavernAuthorSections(draft) : [], [draft, imported]);
    const pageCount = imported ? authorPages.length : nativePages.length;
    const visiblePage = Math.min(page, Math.max(0, pageCount - 1));
    const currentNative = nativePages[visiblePage];
    const currentAuthor = authorPages[visiblePage];
    const tokenEstimate = useMemo(() => estimateStoryTokens(draft.prompts.filter(prompt => prompt.enabled).map(prompt => prompt.content).join('\n') + (draft.assistantPrefill || '')), [draft]);

    const choose = (id?: string) => {
        if (!currentNative) return;
        setDraft(value => applyStoryPresetChoice(value, currentNative.ids, id));
    };
    const chooseAuthor = (id: string) => {
        if (!currentAuthor) return;
        setDraft(value => selectStoryTavernAuthorOption(value, currentAuthor.key, id));
    };

    const apply = async () => {
        setSaving(true);
        try { await onApply(draft); onClose(); }
        finally { setSaving(false); }
    };

    return <div className='absolute inset-0 z-40 bg-slate-950/35 flex items-end sm:items-center justify-center' onClick={onClose}>
        <section onClick={event => event.stopPropagation()} className='w-full max-w-xl max-h-[82%] rounded-t-[28px] sm:rounded-[28px] bg-stone-100 shadow-2xl flex flex-col overflow-hidden'>
            <header className='shrink-0 px-5 pt-5 pb-4 border-b border-slate-200'>
                <div className='flex items-center gap-3'><span className='w-9 h-9 rounded-full bg-slate-900 text-white grid place-items-center'><SlidersHorizontal size={17} /></span><div className='min-w-0 flex-1'><div className='text-[9px] tracking-[.2em] uppercase font-bold text-neutral-500'>Quick preset</div><h2 className='text-sm font-bold truncate'>{document.name}</h2></div><button onClick={onClose} className='w-9 h-9 rounded-full grid place-items-center'><X size={18} /></button></div>
                <div className='mt-2 text-right text-[9px] text-slate-400'>{tokenEstimate.toLocaleString()} tokens</div>
            </header>

            <main className='flex-1 overflow-y-auto px-5 py-5'>
                {imported && authorPages.length > 1 && <nav aria-label='原作者预设分组'
                    className='-mx-5 -mt-1 mb-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:thin]'>
                    {authorPages.map((section, index) =>
                        <button type='button' key={section.key} onClick={() => setPage(index)}
                            aria-current={index === visiblePage ? 'page' : undefined}
                            className={'shrink-0 max-w-[160px] rounded-xl border px-3 py-2 text-[11px] font-semibold truncate ' +
                                (index === visiblePage
                                    ? 'bg-slate-900 border-slate-900 text-white'
                                    : 'bg-white border-slate-200 text-slate-600')}>
                            {section.label}
                        </button>)}
                </nav>}
                {currentAuthor ? <>
                    <div className='flex items-center justify-between gap-3'>
                        <span className='text-[9px] font-bold tabular-nums tracking-wider text-neutral-400'>{visiblePage + 1} / {pageCount}</span>
                        <span className='rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-medium text-slate-500'>{currentAuthor.single ? '原作者单选' : '按作者独立开关'}</span>
                    </div>
                    <h3 className='mt-2 text-[20px] font-bold leading-7 text-slate-800 break-words'>{currentAuthor.label}</h3>
                    <p className='mt-2 text-[11px] leading-5 text-slate-500'>
                        当前：{currentAuthor.options.filter(option => option.enabled).map(option => option.label).join('、') || '未启用'}
                    </p>
                    <div className='mt-4 flex flex-wrap gap-2' data-story-quick-author-options={currentAuthor.key}>
                        {currentAuthor.options.map(option => <button key={option.id} type='button'
                            onClick={() => chooseAuthor(option.id)} disabled={saving}
                            aria-pressed={option.enabled}
                            className={'max-w-full min-h-10 flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] font-medium transition-colors disabled:opacity-50 ' +
                                (option.enabled ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700')}>
                            <span className={'flex h-4 w-4 shrink-0 items-center justify-center border ' +
                                (currentAuthor.single ? 'rounded-full ' : 'rounded-[5px] ') +
                                (option.enabled ? 'border-white/60 text-white' : 'border-slate-300 text-transparent')}>
                                <Check size={11} weight='bold' />
                            </span>
                            <span className='break-words [overflow-wrap:anywhere]'>{option.label}</span>
                        </button>)}
                    </div>
                    <p className='mt-5 text-[10px] leading-5 text-slate-400'>仅修改本剧情中原作者条目的启用状态，下一次推进按新规则生成。</p>
                </> : currentNative ? <>
                    <div className='text-[9px] font-bold text-neutral-500'>{visiblePage + 1} / {pageCount}</div>
                    <h3 className='mt-1 text-3xl font-serif font-semibold'>{currentNative.label}</h3>
                    <p className='mt-2 text-[11px] leading-5 text-slate-500'>{currentNative.hint}</p>
                    <div className='mt-6 border-y border-slate-200 divide-y divide-slate-200'>{currentNative.options.map(option => {
                        const activeId = currentNative.ids.find(id => draft.prompts.find(prompt => prompt.id === id)?.enabled);
                        const selected = option.id ? activeId === option.id : !activeId;
                        return <button key={option.id || 'default'} onClick={() => choose(option.id)} className='w-full py-3.5 flex items-center gap-3 text-left'><span className={'w-5 h-5 rounded-full border grid place-items-center ' + (selected ? 'bg-neutral-600 border-neutral-600 text-white' : 'border-slate-300 text-transparent')}><Check size={12} weight='bold' /></span><span className='text-xs font-semibold'>{option.label}</span></button>;
                    })}</div>
                </> : <div className='py-12 text-center text-xs leading-6 text-slate-400'>
                    '暂无可选项'
                </div>}
            </main>

            <footer className='story-safe-sheet shrink-0 px-5 pt-3 border-t border-slate-200'>
                <div className='flex items-center justify-between'><button disabled={visiblePage === 0} onClick={() => setPage(value => Math.max(0, value - 1))} className='w-10 h-10 rounded-full border border-slate-200 bg-white grid place-items-center disabled:opacity-25'><CaretLeft size={17} /></button><div className='flex gap-1'>{pageCount > 8
                    ? <span className='text-[10px] tabular-nums text-slate-500'>{visiblePage + 1} / {pageCount}</span>
                    : Array.from({ length: pageCount }, (_, index) => <button key={index} aria-label={'第' + (index + 1) + '组'} onClick={() => setPage(index)} className={`h-1.5 rounded-full transition-all ${index === visiblePage ? 'w-5 bg-neutral-600' : 'w-1.5 bg-slate-300'}`} />)}</div><button disabled={visiblePage >= pageCount - 1} onClick={() => setPage(value => Math.min(pageCount - 1, value + 1))} className='w-10 h-10 rounded-full border border-slate-200 bg-white grid place-items-center disabled:opacity-25'><CaretRight size={17} /></button></div>
                <div className='mt-3 flex gap-2'>{hasOverride && <button onClick={async () => { await onReset(); onClose(); }} className='px-4 py-3 rounded-xl border border-slate-200 text-[10px] font-bold text-slate-500'>恢复原预设</button>}<button disabled={saving || (!currentNative && !currentAuthor)} onClick={apply} className='flex-1 py-3 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-40'>{saving ? '应用中' : '应用到本剧情'}</button></div>
            </footer>
        </section>
    </div>;
};

export default StoryQuickPresetPanel;
